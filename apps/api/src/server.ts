/**
 * server.ts — Express API entry point.
 *
 * Hot path:    POST /check
 * Dashboard:   GET /usage/:id, GET /analytics/:id, GET /requests/:id
 * Admin:       CRUD /clients
 * Health:      GET /health
 */

import dotenv from "dotenv";
dotenv.config();

import express, { Request, Response, Express } from "express";
import http from "http";
import { checkLimit, getCurrentUsage } from "./services/rateLimiter";
import { logRequest } from "./services/requestLogger";
import { getClientAnalytics, isValidRange, ALLOWED_RANGES } from "./services/analytics";
import {
  refreshClientCache,
  listClients,
  getClient,
  upsertClient,
  deleteClient,
} from "./config/clientConfig";
import prisma from "./lib/prisma";
import redis from "./lib/redis";

const app: Express = express();
app.use(express.json());

// CORS — tighten origin in production.
app.use((req: Request, res: Response, next: () => void) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ---------------------------------------------------------------------------
// POST /check — core rate-limit check (hot path)
// ---------------------------------------------------------------------------

app.post("/check", async (req: Request, res: Response) => {
  const { clientId } = req.body;
  if (!clientId) return res.status(400).json({ error: "clientId is required" });

  const start = process.hrtime.bigint();

  try {
    const result = await checkLimit(clientId);
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    res.set("X-Response-Time-Ms", elapsedMs.toFixed(2));

    logRequest({
      clientId,
      status: result.allowed ? "allowed" : "denied",
      responseTimeMs: elapsedMs,
      source: result.source,
    });

    const status = result.allowed ? 200 : 429;
    return res.status(status).json({
      allowed: result.allowed,
      clientId,
      count: result.count,
      limit: result.limit,
      source: result.source,
    });
  } catch (err) {
    console.error("[POST /check] unexpected error:", err);
    return res.status(500).json({ error: "internal error" });
  }
});

// ---------------------------------------------------------------------------
// GET /usage/:clientId — current window snapshot (dashboard)
// ---------------------------------------------------------------------------

app.get("/usage/:clientId", async (req: Request, res: Response) => {
  const clientId = req.params.clientId as string;
  try {
    const usage = await getCurrentUsage(clientId);
    return res.status(200).json({ clientId, ...usage });
  } catch (err) {
    console.error("[GET /usage/:clientId] unexpected error:", err);
    return res.status(500).json({ error: "internal error" });
  }
});

// ---------------------------------------------------------------------------
// GET /analytics/:clientId?range=10d|15d|30d — historical analytics
// ---------------------------------------------------------------------------

app.get("/analytics/:clientId", async (req: Request, res: Response) => {
  const clientId = req.params.clientId as string;
  const range = (req.query.range as string) || "10d";

  if (!isValidRange(range)) {
    return res.status(400).json({
      error: `invalid range "${range}" -- must be one of ${Object.keys(ALLOWED_RANGES).join(", ")}`,
    });
  }

  try {
    const analytics = await getClientAnalytics(clientId, range);
    return res.status(200).json(analytics);
  } catch (err) {
    console.error("[GET /analytics/:clientId] unexpected error:", err);
    return res.status(500).json({ error: "internal error" });
  }
});

// ---------------------------------------------------------------------------
// GET /requests/:clientId — recent request log with optional filters
//   ?status=allowed|denied  ?source=redis|local-fallback  ?maxLatency=N  ?limit=N
// ---------------------------------------------------------------------------

app.get("/requests/:clientId", async (req: Request, res: Response) => {
  const clientId = req.params.clientId as string;
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string, 10) || 50));
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const source = typeof req.query.source === "string" ? req.query.source : undefined;
  const maxLatency = typeof req.query.maxLatency === "string"
    ? parseFloat(req.query.maxLatency)
    : undefined;

  const where: Record<string, unknown> = { clientId };
  if (status === "allowed" || status === "denied") where.status = status;
  if (source === "redis" || source === "local-fallback") where.source = source;
  if (maxLatency !== undefined && !isNaN(maxLatency)) {
    where.responseTimeMs = { lte: maxLatency };
  }

  try {
    const requests = await prisma.request.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        status: true,
        responseTimeMs: true,
        source: true,
        createdAt: true,
      },
    });

    return res.status(200).json(
      requests.map((r) => ({
        id: String(r.id),
        status: r.status,
        responseTimeMs: Number(r.responseTimeMs),
        source: r.source,
        createdAt: r.createdAt.toISOString(),
      }))
    );
  } catch (err) {
    console.error("[GET /requests/:clientId] unexpected error:", err);
    return res.status(500).json({ error: "internal error" });
  }
});

// ---------------------------------------------------------------------------
// Client config CRUD
// ---------------------------------------------------------------------------

app.get("/clients", async (_req: Request, res: Response) => {
  try {
    return res.status(200).json(await listClients());
  } catch (err) {
    console.error("[GET /clients] unexpected error:", err);
    return res.status(500).json({ error: "internal error" });
  }
});

app.get("/clients/:id", async (req: Request, res: Response) => {
  try {
    const client = await getClient(req.params.id as string);
    if (!client) return res.status(404).json({ error: "client not found" });
    return res.status(200).json(client);
  } catch (err) {
    console.error("[GET /clients/:id] unexpected error:", err);
    return res.status(500).json({ error: "internal error" });
  }
});

app.post("/clients", async (req: Request, res: Response) => {
  const { id, limitPerMinute, displayName } = req.body;

  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "id is required (string)" });
  }
  if (typeof limitPerMinute !== "number" || limitPerMinute < 1) {
    return res.status(400).json({ error: "limitPerMinute must be a positive number" });
  }

  try {
    return res.status(200).json(await upsertClient({ id, limitPerMinute, displayName }));
  } catch (err) {
    console.error("[POST /clients] unexpected error:", err);
    return res.status(500).json({ error: "internal error" });
  }
});

app.put("/clients/:id", async (req: Request, res: Response) => {
  const { limitPerMinute, displayName } = req.body;

  if (typeof limitPerMinute !== "number" || limitPerMinute < 1) {
    return res.status(400).json({ error: "limitPerMinute must be a positive number" });
  }

  try {
    const existing = await getClient(req.params.id as string);
    if (!existing) return res.status(404).json({ error: "client not found" });
    const client = await upsertClient({
      id: req.params.id as string,
      limitPerMinute,
      displayName: displayName ?? existing.displayName ?? undefined,
    });
    return res.status(200).json(client);
  } catch (err) {
    console.error("[PUT /clients/:id] unexpected error:", err);
    return res.status(500).json({ error: "internal error" });
  }
});

app.delete("/clients/:id", async (req: Request, res: Response) => {
  try {
    const deleted = await deleteClient(req.params.id as string);
    if (!deleted) return res.status(404).json({ error: "client not found" });
    return res.status(200).json({ deleted: true });
  } catch (err) {
    console.error("[DELETE /clients/:id] unexpected error:", err);
    return res.status(500).json({ error: "internal error" });
  }
});

// ---------------------------------------------------------------------------
// Health + startup + shutdown
// ---------------------------------------------------------------------------

app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
});

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

async function seedDefaults(): Promise<void> {
  const defaults = [
    { id: "client-a", limitPerMinute: 100, displayName: "Client A" },
    { id: "client-b", limitPerMinute: 5000, displayName: "Client B" },
  ];
  for (const c of defaults) {
    await prisma.clientConfig.upsert({
      where: { id: c.id },
      update: { limitPerMinute: c.limitPerMinute, displayName: c.displayName },
      create: c,
    });
  }
  console.log("[startup] seeded default client configurations");
}

async function start() {
  try {
    await seedDefaults();
    await refreshClientCache();
    server.listen(PORT, () => {
      console.log(`Rate limiter service listening on port ${PORT}`);
    });
  } catch (err) {
    console.error("[startup] failed:", err);
    process.exit(1);
  }
}

start();

async function shutdown(signal: string) {
  console.log(`\n[${signal}] received, shutting down...`);
  server.close(async () => {
    await prisma.$disconnect();
    redis.disconnect();
    process.exit(0);
  });
  setTimeout(() => {
    console.error("[shutdown] forced exit after 10s timeout");
    process.exit(1);
  }, 10000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export default app;
