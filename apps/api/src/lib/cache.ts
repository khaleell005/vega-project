/**
 * cache.ts — Redis-backed caching layer with fail-open design.
 *
 * Provides three functions:
 *   cacheGet<T>(key)          — read from cache, return null on miss/error
 *   cacheSet(key, value, ttl)  — write to cache with TTL
 *   cacheInvalidate(pattern)   — delete keys matching a glob pattern
 *
 * Design principles:
 *   - Fail-open: every function swallows errors and returns gracefully.
 *     Cache failures must NEVER break the main request flow.
 *   - JSON serialization: values are stored as JSON strings. Non-serializable
 *     values will produce "[object Object]" — caller's responsibility to
 *     pass serializable data.
 *   - SCAN-based invalidation: uses cursor-based SCAN instead of KEYS to
 *     avoid blocking Redis under load. KEYS scans the entire keyspace in
 *     O(N) and is explicitly discouraged in production.
 *
 * Usage in the system:
 *   - analytics.ts caches Postgres query results for 30 seconds
 *   - rateLimiter.ts caches usage snapshots for 5 seconds
 *   - requestLogger.ts invalidates both caches on each logged request
 */

import redis from "./redis";

/** Default TTL for cached values (seconds). */
const DEFAULT_TTL_SECONDS = 30;

/**
 * Read a cached value by key.
 * Returns null on cache miss or any Redis/parse error (fail-open).
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Write a value to cache with a TTL.
 * Fail-open: errors are silently swallowed.
 */
export async function cacheSet(
  key: string,
  value: unknown,
  ttlSeconds: number = DEFAULT_TTL_SECONDS
): Promise<void> {
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch {
    // Cache write failure is non-critical — just skip.
  }
}

/**
 * Invalidate all keys matching a glob pattern (e.g. "cache:analytics:client-a:*").
 *
 * Uses SCAN with cursor-based iteration instead of KEYS. KEYS would block
 * Redis for the entire duration of the scan (O(N) over all keys in the DB),
 * which is dangerous under load. SCAN iterates in batches of 100 keys,
 * yielding control back to Redis between batches.
 *
 * Fail-open: errors are silently swallowed.
 */
export async function cacheInvalidate(pattern: string): Promise<void> {
  try {
    let cursor = "0";
    do {
      const [nextCursor, keys] = await redis.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        100
      );
      cursor = nextCursor;
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } while (cursor !== "0");
  } catch {
    // Invalidation failure is non-critical.
  }
}
