import { Router, Request, Response } from "express";
import { getClientAnalytics, isValidRange } from "../services/analytics";

const router: ReturnType<typeof Router> = Router();

router.get("/analytics/:clientId", async (req: Request, res: Response) => {
  const clientId = req.params.clientId as string;
  const range = (req.query.range as string) || "10d";

  if (!isValidRange(range)) {
    return res.status(400).json({
      error: `invalid range "${range}" -- must be one of: 10d, 15d, 30d`,
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

export default router;
