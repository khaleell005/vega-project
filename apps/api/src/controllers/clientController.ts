import { Router, Request, Response } from "express";
import { listClients, getClient, upsertClient, deleteClient } from "../config/clientConfig";

const router: ReturnType<typeof Router> = Router();

router.get("/clients", async (_req: Request, res: Response) => {
  try {
    return res.status(200).json(await listClients());
  } catch (err) {
    console.error("[GET /clients] unexpected error:", err);
    return res.status(500).json({ error: "internal error" });
  }
});

router.get("/clients/:id", async (req: Request, res: Response) => {
  try {
    const client = await getClient(req.params.id as string);
    if (!client) return res.status(404).json({ error: "client not found" });
    return res.status(200).json(client);
  } catch (err) {
    console.error("[GET /clients/:id] unexpected error:", err);
    return res.status(500).json({ error: "internal error" });
  }
});

router.post("/clients", async (req: Request, res: Response) => {
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

router.put("/clients/:id", async (req: Request, res: Response) => {
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

router.delete("/clients/:id", async (req: Request, res: Response) => {
  try {
    const deleted = await deleteClient(req.params.id as string);
    if (!deleted) return res.status(404).json({ error: "client not found" });
    return res.status(200).json({ deleted: true });
  } catch (err) {
    console.error("[DELETE /clients/:id] unexpected error:", err);
    return res.status(500).json({ error: "internal error" });
  }
});

export default router;
