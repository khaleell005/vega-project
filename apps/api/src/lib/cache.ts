/**
 * cache.ts — Redis-backed caching with fail-open design.
 *
 * All functions swallow errors — cache failures never break the main flow.
 * Uses SCAN (not KEYS) for invalidation to avoid blocking Redis under load.
 */

import redis from "./redis";

const DEFAULT_TTL_SECONDS = 30;

/** Read cached value by key. Returns null on miss or error. */
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Write value to cache with TTL. Errors silently swallowed. */
export async function cacheSet(
  key: string,
  value: unknown,
  ttlSeconds: number = DEFAULT_TTL_SECONDS
): Promise<void> {
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch {
    // Non-critical.
  }
}

/** Delete keys matching a glob pattern via cursor-based SCAN. */
export async function cacheInvalidate(pattern: string): Promise<void> {
  try {
    let cursor = "0";
    do {
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = nextCursor;
      if (keys.length > 0) await redis.del(...keys);
    } while (cursor !== "0");
  } catch {
    // Non-critical.
  }
}
