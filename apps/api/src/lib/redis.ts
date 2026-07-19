/**
 * redis.ts — ioredis connection singleton.
 *
 * maxRetriesPerRequest: 1 — circuit breaker handles retries at a higher level.
 * retryStrategy: linear backoff capped at 2s for quick reconnection.
 */

import Redis from "ioredis";

const redis = new Redis({
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379", 10),
  maxRetriesPerRequest: 1,
  retryStrategy(times: number): number {
    return Math.min(times * 200, 2000);
  },
});

redis.on("error", (err: Error) => {
  console.error("[redis] connection error:", err.message);
});

redis.on("connect", () => {
  console.log("[redis] connected");
});

export default redis;
