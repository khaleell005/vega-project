import { Router, Request, Response } from "express";
import { checkLimit, getCurrentUsage } from "../services/rateLimiter";
import { logRequest } from "../services/requestLogger";

const router: ReturnType<typeof Router> = Router();

router.post("/check", async (req: Request, res: Response) => {
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

router.get("/usage/:clientId", async (req: Request, res: Response) => {
  const clientId = req.params.clientId as string;
  try {
    const usage = await getCurrentUsage(clientId);
    return res.status(200).json({ clientId, ...usage });
  } catch (err) {
    console.error("[GET /usage/:clientId] unexpected error:", err);
    return res.status(500).json({ error: "internal error" });
  }
});

export default router;
