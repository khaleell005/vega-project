/**
 * redisClient.ts — ioredis connection singleton.
 *
 * Creates a single Redis client instance shared by the rate limiter,
 * cache layer, and any other module that needs Redis.
 *
 * Configuration:
 *   - host/port: from environment variables (defaults to localhost:6379)
 *   - maxRetriesPerRequest: 1 — don't retry individual commands; let the
 *     circuit breaker handle retries at a higher level
 *   - retryStrategy: linear backoff capped at 2 seconds — aggressive enough
 *     to reconnect quickly, but not so aggressive it overwhelms a restarting
 *     Redis instance
 *
 * The circuit breaker in rateLimiter.ts handles the case where Redis is
 * completely down — this client just tries to maintain a connection.
 */

import dotenv from "dotenv";
dotenv.config();

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
