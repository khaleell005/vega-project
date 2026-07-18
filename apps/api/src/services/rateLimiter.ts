/**
 * rateLimiter.ts — Core rate-limiting logic.
 *
 * This module provides two public functions:
 *   checkLimit(clientId)     — atomic check-and-increment (the hot path)
 *   getCurrentUsage(clientId) — read-only snapshot of current window
 *
 * Architecture:
 *   1. The hot path (checkLimit) delegates to a Redis Lua script via the
 *      opossum circuit breaker. The Lua script is atomic — no race conditions
 *      are possible even under extreme concurrency across multiple instances.
 *   2. If Redis is unavailable (circuit breaker is open), requests fall back
 *      to per-process in-memory counters. Limits become approximate during
 *      the outage, but traffic is never blocked.
 *   3. getCurrentUsage() reads the current window count from Redis (or 0 on
 *      failure). Results are cached for 5 seconds to reduce Redis reads from
 *      the dashboard's 4-second polling interval.
 *
 * Fixed-window design:
 *   Time is divided into 60-second buckets (windowBucket = floor(now / 60000)).
 *   The Redis key is `ratelimit:{clientId}:{windowBucket}`, so each window
 *   is a separate key that auto-expires after the window ends. This means
 *   no manual cleanup is needed — Redis TTL handles garbage collection.
 */

import fs from "fs";
import path from "path";
import CircuitBreaker from "opossum";
import redis from "../lib/redis";
import { getClientLimit } from "../config/clientConfig";
import { cacheGet, cacheSet } from "../lib/cache";

/** Result of a rate-limit check — returned to the caller. */
export interface LimitResult {
  allowed: boolean;   // was the request within the limit?
  count: number;      // how many requests in this window so far
  limit: number;      // the client's per-minute limit
  source: string;     // "redis" or "local-fallback"
}

/** Read-only snapshot of current window usage (for the dashboard). */
export interface UsageResult {
  count: number;                 // current request count in this window
  limit: number;                 // client's limit
  windowSecondsRemaining: number; // seconds until the window resets
}

/** Fixed window length — all limits are per-minute. */
const WINDOW_SECONDS = 60;

/**
 * Load the Lua script at startup. This script runs atomically inside Redis
 * (no other command can interleave), which is what makes the limiter correct
 * under concurrency. See rateLimit.lua for the full implementation.
 */
const luaScript = fs.readFileSync(
  path.join(__dirname, "../lua/rateLimit.lua"),
  "utf8"
);

/**
 * In-memory fallback counters — used when Redis is unavailable.
 *
 * Key format: `{clientId}:{windowBucket}`
 * Limitation: these are per-process, so in a multi-instance cluster,
 * each instance maintains its own count. During a Redis outage, limits
 * become approximate (each instance thinks it has the full budget).
 * This is an acceptable tradeoff — the alternative is blocking all
 * traffic, which violates the fail-safe requirement.
 */
const localCounters = new Map<string, number>();

/**
 * Fallback rate check when Redis is down.
 *
 * Uses a simple in-memory counter per (clientId, windowBucket) pair.
 * If the counter map grows past 10,000 entries (many distinct clients
 * during a long outage), it's cleared entirely to prevent memory leaks.
 * This is a blunt heuristic — acceptable for a degraded-mode fallback.
 */
function localFallbackCheck(clientId: string, limit: number): LimitResult {
  const windowBucket = Math.floor(Date.now() / (WINDOW_SECONDS * 1000));
  const key = `${clientId}:${windowBucket}`;
  const current = (localCounters.get(key) || 0) + 1;
  localCounters.set(key, current);

  // Prevent unbounded memory growth during extended outages.
  if (localCounters.size > 10000) {
    localCounters.clear();
  }

  return {
    allowed: current <= limit,
    count: current,
    limit,
    source: "local-fallback",
  };
}

/**
 * Primary rate check — runs the Lua script atomically in Redis.
 *
 * The Lua script (rateLimit.lua) does:
 *   1. GET the current count for this window
 *   2. If count < limit: INCR and return {1, newCount, limit}
 *   3. If count >= limit: return {0, currentCount, limit} (no increment)
 *   4. If key doesn't exist: SET 1 with TTL and return {1, 1, limit}
 *
 * This is a single EVAL command — one network round-trip, fully atomic.
 * The circuit breaker wraps this with a 50ms timeout (Requirement #3).
 */
async function redisCheck(clientId: string, limit: number): Promise<LimitResult> {
  const windowBucket = Math.floor(Date.now() / (WINDOW_SECONDS * 1000));
  const key = `ratelimit:${clientId}:${windowBucket}`;

  const [allowed, count] = (await redis.eval(
    luaScript,
    1,       // number of keys
    key,     // KEYS[1]
    limit,   // ARGV[1]
    WINDOW_SECONDS // ARGV[2]
  )) as [number, number];

  return {
    allowed: allowed === 1,
    count,
    limit,
    source: "redis",
  };
}

/**
 * Circuit breaker wrapping the Redis check.
 *
 * Configuration:
 *   - timeout: 50ms — if Redis doesn't respond in 50ms, trigger fallback
 *   - errorThresholdPercentage: 50 — open the circuit after 50% of requests fail
 *   - resetTimeout: 5000 — try Redis again after 5 seconds (half-open probe)
 *   - rollingCountTimeout: 10000 — error stats window
 *
 * State machine:
 *   CLOSED  → normal operation, Redis is healthy
 *   OPEN    → Redis is failing, all requests go to local fallback
 *   HALF-OPEN → probe: one request goes to Redis to see if it's back
 */
const breaker = new CircuitBreaker(redisCheck, {
  timeout: 50,
  errorThresholdPercentage: 50,
  resetTimeout: 5000,
  rollingCountTimeout: 10000,
});

// Attach the fallback function — called when circuit is open or timeout fires.
breaker.fallback((clientId: string, limit: number) =>
  localFallbackCheck(clientId, limit)
);

// Log state transitions for operational visibility.
breaker.on("open", () =>
  console.warn("[circuit-breaker] OPEN - Redis unavailable, using local fallback")
);
breaker.on("close", () =>
  console.log("[circuit-breaker] CLOSED - Redis check succeeded, back to normal")
);
breaker.on("halfOpen", () =>
  console.log("[circuit-breaker] HALF-OPEN - probing Redis again")
);

/**
 * Public API: check whether a request is allowed.
 *
 * Looks up the client's limit, then fires through the circuit breaker.
 * If Redis is healthy → Lua script runs atomically.
 * If Redis is down → local fallback enforces approximate limits.
 */
export async function checkLimit(clientId: string): Promise<LimitResult> {
  const limit = getClientLimit(clientId);
  return breaker.fire(clientId, limit) as Promise<LimitResult>;
}

// ---------------------------------------------------------------------------
// Usage snapshot (read-only, for the dashboard)
// ---------------------------------------------------------------------------

/** How long to cache usage reads — 5s balances freshness vs. Redis load. */
const USAGE_CACHE_TTL = 5;

/**
 * Get the current window's request count without incrementing.
 *
 * Reads the Redis key directly (no Lua, no increment). Results are cached
 * for 5 seconds because the dashboard polls every 4 seconds — this avoids
 * a Redis read on every poll while still showing near-real-time data.
 *
 * If Redis is unavailable, returns count: 0 (fail-open).
 */
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
    const error = err as Error;
    console.error("[getCurrentUsage] redis read failed:", error.message);
  }

  // Calculate how many seconds remain in the current window.
  const windowStartMs = windowBucket * WINDOW_SECONDS * 1000;
  const windowSecondsRemaining = Math.max(
    0,
    WINDOW_SECONDS - Math.floor((nowMs - windowStartMs) / 1000)
  );

  const result: UsageResult = { count, limit, windowSecondsRemaining };
  await cacheSet(cacheKey, result, USAGE_CACHE_TTL);

  return result;
}
