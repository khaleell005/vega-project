/**
 * raceCondition.test.ts — Atomicity verification tests.
 *
 * PROVES: "Rate limit checks must be accurate regardless of which service
 * instance receives the request" — specifically, that concurrent requests
 * can't slip past the limit due to a read-then-write race.
 *
 * WHY THIS MATTERS:
 *   In a multi-instance deployment, 10 replicas might each receive requests
 *   for the same client simultaneously. Without atomic rate limiting, two
 *   instances could both read count=59, both decide "one more is fine", and
 *   both increment — allowing 61 requests against a 60 limit. The Lua script
 *   (rateLimit.lua) prevents this by running the entire check-and-increment
 *   as a single atomic Redis command.
 *
 * TEST APPROACH:
 *   - Calls the Lua script DIRECTLY via redis.eval (not through the circuit
 *     breaker) to isolate the atomicity guarantee
 *   - Fires 300 concurrent eval calls against a 60/min limit (5x margin)
 *   - Asserts exactly 60 are allowed — any race condition would allow more
 *   - Uses Promise.all for maximum concurrency (harder than real HTTP, where
 *     network jitter naturally de-interleaves requests)
 *
 * NOTE: We bypass the circuit breaker here because the breaker is a separate
 * concern — it's tested in failSafe.test.ts. Here we want to prove the Lua
 * script itself is atomic, regardless of the breaker state.
 *
 * ISOLATION:
 *   Each test uses a unique clientId (timestamped) to avoid collisions with
 *   other tests or manual traffic. The Redis key auto-expires after 60 seconds.
 *
 * REQUIRES: Running Redis instance (see README for setup).
 */

import fs from "fs";
import path from "path";
import redis from "../src/lib/redis";
import { DEFAULT_LIMIT_PER_MINUTE } from "../src/config/clientConfig";

/**
 * Load the Lua script — the same one used by rateLimiter.ts.
 * We call it directly to bypass the circuit breaker and test atomicity
 * in isolation.
 */
const luaScript = fs.readFileSync(
  path.join(__dirname, "..", "src", "lua", "rateLimit.lua"),
  "utf8"
);

const WINDOW_SECONDS = 60;

/**
 * Helper: call the Lua rate-limit script directly.
 * Returns { allowed, count, limit } — same as the production path.
 */
async function evalRateLimit(
  clientId: string,
  limit: number
): Promise<{ allowed: boolean; count: number; limit: number }> {
  const windowBucket = Math.floor(Date.now() / (WINDOW_SECONDS * 1000));
  const key = `ratelimit:${clientId}:${windowBucket}`;

  const [allowed, count] = (await redis.eval(
    luaScript,
    1,
    key,
    limit,
    WINDOW_SECONDS
  )) as [number, number];

  return {
    allowed: allowed === 1,
    count,
    limit,
  };
}

/**
 * Clean up the Redis connection after all tests complete.
 * Without this, Jest would hang waiting for the open socket to close.
 */
afterAll(async () => {
  await redis.quit();
});

/**
 * Test 1: Concurrent requests — exactly `limit` allowed out of many.
 *
 * This is the core race-condition test. We fire 300 requests simultaneously
 * at a client with DEFAULT_LIMIT_PER_MINUTE (60). If the Lua script is truly
 * atomic, exactly 60 will be allowed and 240 will be denied — no more, no less.
 *
 * A non-atomic implementation would allow 61+ due to the classic TOCTOU
 * (Time-of-Check-to-Time-of-Use) race: two requests read the same count,
 * both pass the check, both increment.
 */
test("exactly `limit` requests are allowed when far more arrive concurrently", async () => {
  // Unique client ID to avoid collisions with other tests or manual traffic.
  const clientId = `race-test-${Date.now()}`;
  const CONCURRENT_REQUESTS = 300; // 5x the limit — generous margin to expose any race

  // Fire all 300 requests simultaneously via Promise.all.
  // This is actually a HARDER test than real HTTP traffic, because:
  //   - In real HTTP, network latency naturally spreads requests out
  //   - Here, all 300 hit Redis in a tight loop with minimal interleaving
  //   - A race condition would show up immediately under this pressure
  const results = await Promise.all(
    Array.from({ length: CONCURRENT_REQUESTS }, () =>
      evalRateLimit(clientId, DEFAULT_LIMIT_PER_MINUTE)
    )
  );

  const allowedCount = results.filter((r) => r.allowed).length;
  const deniedCount = results.filter((r) => !r.allowed).length;

  // The critical assertion: exactly DEFAULT_LIMIT_PER_MINUTE requests allowed.
  // If this fails, the Lua script's atomicity is broken.
  expect(allowedCount).toBe(DEFAULT_LIMIT_PER_MINUTE);
  expect(deniedCount).toBe(CONCURRENT_REQUESTS - DEFAULT_LIMIT_PER_MINUTE);
});

/**
 * Test 2: Client isolation — two clients' limits never interfere.
 *
 * In a per-client rate limiter, client A's count must not affect client B's
 * count. This test fires 80 requests for each of two clients simultaneously,
 * interleaving them via Promise.all. Both should get exactly 60 allowed
 * (DEFAULT_LIMIT_PER_MINUTE), proving the Redis key namespacing
 * (ratelimit:{clientId}:{window}) keeps counters separate.
 */
test("two different clients' limits never interfere with each other", async () => {
  const clientA = `race-test-a-${Date.now()}`;
  const clientB = `race-test-b-${Date.now()}`;

  // Interleave calls for two independent clients.
  // Promise.all runs both arrays concurrently, mixing their Redis calls.
  const [resultsA, resultsB] = await Promise.all([
    Promise.all(
      Array.from({ length: 80 }, () =>
        evalRateLimit(clientA, DEFAULT_LIMIT_PER_MINUTE)
      )
    ),
    Promise.all(
      Array.from({ length: 80 }, () =>
        evalRateLimit(clientB, DEFAULT_LIMIT_PER_MINUTE)
      )
    ),
  ]);

  const allowedA = resultsA.filter((r) => r.allowed).length;
  const allowedB = resultsB.filter((r) => r.allowed).length;

  // Each client should get exactly 60 allowed — not 120 (shared counter)
  // or some other number (cross-contamination).
  expect(allowedA).toBe(DEFAULT_LIMIT_PER_MINUTE);
  expect(allowedB).toBe(DEFAULT_LIMIT_PER_MINUTE);
});
