import express, { Request, Response, Express } from "express";
import rateLimitController from "./controllers/rateLimitController";
import analyticsController from "./controllers/analyticsController";
import requestController from "./controllers/requestController";
import clientController from "./controllers/clientController";

const app: Express = express();
app.use(express.json());

app.use((req: Request, res: Response, next: () => void) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
});

app.use(rateLimitController);
app.use(analyticsController);
app.use(requestController);
app.use(clientController);

export default app;
