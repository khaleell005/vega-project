/**
 * rateLimiter.ts — Core rate-limiting logic.
 *
 * checkLimit(clientId)      — atomic check-and-increment (hot path)
 * getCurrentUsage(clientId) — read-only snapshot for the dashboard
 *
 * Hot path runs a Lua script atomically in Redis via an opossum circuit
 * breaker. If Redis is unavailable, falls back to per-process in-memory
 * counters (limits become approximate but traffic is never blocked).
 */

import fs from "fs";
import path from "path";
import CircuitBreaker from "opossum";
import redis from "../lib/redis";
import { getClientLimit } from "../config/clientConfig";
import { cacheGet, cacheSet } from "../lib/cache";

export interface LimitResult {
  allowed: boolean;
  count: number;
  limit: number;
  source: string; // "redis" or "local-fallback"
}

export interface UsageResult {
  count: number;
  limit: number;
  windowSecondsRemaining: number;
}

const WINDOW_SECONDS = 60;

// Load Lua script — runs atomically inside Redis (no interleaving possible).
const luaScript = fs.readFileSync(
  path.join(__dirname, "../lua/rateLimit.lua"),
  "utf8"
);

// In-memory fallback counters (per-process, used when Redis is down).
const localCounters = new Map<string, number>();

function localFallbackCheck(clientId: string, limit: number): LimitResult {
  const windowBucket = Math.floor(Date.now() / (WINDOW_SECONDS * 1000));
  const key = `${clientId}:${windowBucket}`;
  const current = (localCounters.get(key) || 0) + 1;
  localCounters.set(key, current);

  // Prevent unbounded memory growth during extended outages.
  if (localCounters.size > 10000) localCounters.clear();

  return { allowed: current <= limit, count: current, limit, source: "local-fallback" };
}

// Primary rate check — single EVAL command, fully atomic.
async function redisCheck(clientId: string, limit: number): Promise<LimitResult> {
  const windowBucket = Math.floor(Date.now() / (WINDOW_SECONDS * 1000));
  const key = `ratelimit:${clientId}:${windowBucket}`;

  const [allowed, count] = (await redis.eval(
    luaScript, 1, key, limit, WINDOW_SECONDS
  )) as [number, number];

  return { allowed: allowed === 1, count, limit, source: "redis" };
}

// Circuit breaker: 50ms timeout, opens at 50% errors, resets after 5s.
const breaker = new CircuitBreaker(redisCheck, {
  timeout: 50,
  errorThresholdPercentage: 50,
  resetTimeout: 5000,
  rollingCountTimeout: 10000,
});

breaker.fallback((clientId: string, limit: number) =>
  localFallbackCheck(clientId, limit)
);

breaker.on("open", () =>
  console.warn("[circuit-breaker] OPEN - using local fallback")
);
breaker.on("close", () =>
  console.log("[circuit-breaker] CLOSED - back to Redis")
);
breaker.on("halfOpen", () =>
  console.log("[circuit-breaker] HALF-OPEN - probing Redis")
);

/** Check whether a request is allowed. Looks up limit, fires through breaker. */
export async function checkLimit(clientId: string): Promise<LimitResult> {
  const limit = getClientLimit(clientId);
  return breaker.fire(clientId, limit) as Promise<LimitResult>;
}

// ---------------------------------------------------------------------------
// Usage snapshot (read-only, for the dashboard)
// ---------------------------------------------------------------------------

const USAGE_CACHE_TTL = 5; // seconds

/** Get current window count without incrementing. Cached 5s to match dashboard polling. */
export async function getCurrentUsage(clientId: string): Promise<UsageResult> {
  const cacheKey = `cache:usage:${clientId}`;
  const cached = await cacheGet<UsageResult>(cacheKey);
  if (cached) return cached;

  const limit = getClientLimit(clientId);
  const nowMs = Date.now();
  const windowBucket = Math.floor(nowMs / (WINDOW_SECONDS * 1000));
  const key = `ratelimit:${clientId}:${windowBucket}`;

  let count = 0;
  try {
    const raw = await redis.get(key);
    count = raw ? parseInt(raw, 10) : 0;
  } catch (err) {
    console.error("[getCurrentUsage] redis read failed:", (err as Error).message);
  }

  const windowStartMs = windowBucket * WINDOW_SECONDS * 1000;
  const windowSecondsRemaining = Math.max(
    0, WINDOW_SECONDS - Math.floor((nowMs - windowStartMs) / 1000)
  );

  const result: UsageResult = { count, limit, windowSecondsRemaining };
  await cacheSet(cacheKey, result, USAGE_CACHE_TTL);
  return result;
}
