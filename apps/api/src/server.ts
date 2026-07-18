/**
 * server.ts — Express API entry point.
 *
 * Exposes four endpoints:
 *   POST /check          — the hot path: is this request allowed?
 *   GET  /usage/:id      — current window stats (read-only, for dashboard)
 *   GET  /analytics/:id  — historical summary + daily trend (for dashboard)
 *   GET  /health          — liveness probe
 *
 * Design notes:
 *   - The /check handler uses process.hrtime.bigint() for nanosecond-precision
 *     latency measurement, which is exposed via the X-Response-Time-Ms header.
 *   - logRequest() is called fire-and-forget (no await) so the database write
 *     never blocks the response. If the DB is down, the user still gets a fast
 *     answer — logging failures are silently swallowed.
 *   - Both allowed AND denied requests are logged, ensuring complete billing
 *     and analytics data.
 *   - Graceful shutdown drains in-flight requests, then disconnects Prisma and
 *     Redis before exiting (important for container orchestrated restarts).
 */

import dotenv from "dotenv";
dotenv.config();

import express, { Request, Response } from "express";
import http from "http";
import { checkLimit, getCurrentUsage } from "./services/rateLimiter";
import { logRequest } from "./services/requestLogger";
import { getClientAnalytics, isValidRange, ALLOWED_RANGES } from "./services/analytics";
import prisma from "./lib/prisma";
import redis from "./lib/redis";

const app = express();
app.use(express.json());

/**
 * CORS middleware — allows the dashboard (served on a different origin/port)
 * to call the API. In production, tighten the origin to the actual dashboard URL.
 */
app.use((req: Request, res: Response, next: () => void) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

/**
 * POST /check — the core rate-limit check.
 *
 * Request body:  { clientId: string }
 * Response:      { allowed, clientId, count, limit, source }
 *
 * The "source" field tells you whether the check was backed by Redis ("redis"),
 * a local in-memory fallback ("local-fallback"), or a cached result.
 * Both allowed (200) and denied (429) requests are logged to Postgres for
 * analytics and billing — logging is fire-and-forget so it never adds latency.
 */
app.post("/check", async (req: Request, res: Response) => {
  const { clientId } = req.body;

  if (!clientId) {
    return res.status(400).json({ error: "clientId is required" });
  }

  // High-precision start time — hrtime.bigint() gives nanosecond resolution.
  const start = process.hrtime.bigint();

  try {
    const result = await checkLimit(clientId);
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;

    // Expose latency as a response header for monitoring/debugging.
    res.set("X-Response-Time-Ms", elapsedMs.toFixed(2));

    if (!result.allowed) {
      // Denied requests are logged too — this is critical for billing
      // and analytics accuracy. The log is fire-and-forget (no await)
      // so it never blocks the 429 response.
      logRequest({
        clientId,
        status: "denied",
        responseTimeMs: elapsedMs,
        source: result.source,
      });

      return res.status(429).json({
        allowed: false,
        clientId,
        count: result.count,
        limit: result.limit,
        source: result.source,
      });
    }

    // Allowed — log for analytics/billing. Fire-and-forget: if the DB
    // write fails, the user still gets their fast response.
    logRequest({
      clientId,
      status: "allowed",
      responseTimeMs: elapsedMs,
      source: result.source,
    });

    return res.status(200).json({
      allowed: true,
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

/**
 * GET /usage/:clientId — read-only snapshot of the current rate-limit window.
 *
 * Returns { count, limit, windowSecondsRemaining } for the dashboard's
 * quota gauge. Uses a 5-second Redis cache to avoid hammering Redis
 * on every dashboard poll (which runs every 4 seconds).
 */
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

/**
 * GET /analytics/:clientId?range=10d|15d|30d — historical analytics.
 *
 * Returns a summary (total, allowed, denied, avg response time) plus a
 * zero-filled daily trend array for charting. Results are cached in
 * Redis for 30 seconds to avoid repeated expensive Postgres aggregation
 * queries (generate_series + LEFT JOIN + GROUP BY).
 */
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

/**
 * GET /requests/:clientId?limit=50 — recent request log for a client.
 *
 * Returns the most recent requests for the dashboard's real-time log.
 * Results are ordered by created_at DESC (newest first).
 * The limit parameter caps how many rows are returned (default 50, max 200).
 *
 * This endpoint is read-heavy but low-traffic (only the dashboard polls it),
 * so no caching is needed — freshness matters more than performance here.
 */
app.get("/requests/:clientId", async (req: Request, res: Response) => {
  const clientId = req.params.clientId as string;
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string, 10) || 50));

  try {
    const requests = await prisma.request.findMany({
      where: { clientId },
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

/**
 * GET /health — liveness probe for container orchestrators (Docker, K8s).
 * Returns 200 { "status": "ok" } if the process is alive.
 */
app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
});

// ---------------------------------------------------------------------------
// Server startup + graceful shutdown
// ---------------------------------------------------------------------------

const PORT = process.env.PORT || 3000;

// Wrap Express in http.createServer so we can call .close() during shutdown.
// This ensures in-flight requests are drained before the process exits.
const server = http.createServer(app);

server.listen(PORT, () => {
  console.log(`Rate limiter service listening on port ${PORT}`);
});

/**
 * Graceful shutdown handler.
 *
 * When Docker sends SIGTERM (default 10s before SIGKILL), this handler:
 *   1. Stops accepting new connections (server.close)
 *   2. Waits for in-flight HTTP requests to finish
 *   3. Disconnects the Prisma connection pool (Postgres)
 *   4. Disconnects the Redis client
 *   5. Exits cleanly with code 0
 *
 * A 10-second safety timeout forces exit if something hangs — this
 * prevents Docker from sending SIGKILL, which doesn't allow any cleanup.
 */
async function shutdown(signal: string) {
  console.log(`\n[${signal}] received, shutting down gracefully...`);
  server.close(async () => {
    console.log("[shutdown] HTTP server closed");
    await prisma.$disconnect();
    console.log("[shutdown] Prisma disconnected");
    redis.disconnect();
    console.log("[shutdown] Redis disconnected");
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
