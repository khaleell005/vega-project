import { Router, Request, Response } from "express";
import { getRequestLogs } from "../services/requestLogger";

const router: ReturnType<typeof Router> = Router();

router.get("/requests/:clientId", async (req: Request, res: Response) => {
  const clientId = req.params.clientId as string;
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string, 10) || 50));
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const source = typeof req.query.source === "string" ? req.query.source : undefined;
  const maxLatency = typeof req.query.maxLatency === "string"
    ? parseFloat(req.query.maxLatency)
    : undefined;

  try {
    const requests = await getRequestLogs({
      clientId,
      limit,
      status: status === "allowed" || status === "denied" ? status : undefined,
      source: source === "redis" || source === "local-fallback" ? source : undefined,
      maxLatency,
    });

    return res.status(200).json(requests);
  } catch (err) {
    console.error("[GET /requests/:clientId] unexpected error:", err);
    return res.status(500).json({ error: "internal error" });
  }
});

export default router;
