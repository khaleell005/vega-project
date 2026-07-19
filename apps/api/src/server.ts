import dotenv from "dotenv";
dotenv.config();

import http from "http";
import app from "./app";
import prisma from "./lib/prisma";
import redis from "./lib/redis";
import { refreshClientCache } from "./config/clientConfig";

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
