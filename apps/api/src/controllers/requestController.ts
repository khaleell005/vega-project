import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";

const router: ReturnType<typeof Router> = Router();

router.get("/requests/:clientId", async (req: Request, res: Response) => {
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

export default router;
