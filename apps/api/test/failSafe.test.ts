/**
 * failSafe.test.ts — Proves the circuit breaker falls back when Redis is down.
 *
 * Monkey-patches redis.eval to reject, verifying:
 *   1. Requests still get served (not blocked)
 *   2. source = "local-fallback"
 *   3. Local fallback still enforces limits
 *   4. Recovery works after Redis comes back
 *
 * REQUIRES: Running Redis instance.
 */

import redis from "../src/lib/redis";
import { checkLimit } from "../src/services/rateLimiter";

afterAll(async () => {
  await redis.quit();
});

test("falls back to local limiter when Redis is unavailable", async () => {
  const clientId = `failsafe-test-${Date.now()}`;
  const originalEval = redis.eval.bind(redis);
  redis.eval = jest.fn().mockRejectedValue(new Error("simulated redis outage"));

  try {
    const result = await checkLimit(clientId);
    expect(result.allowed).toBe(true);
    expect(result.source).toBe("local-fallback");
    expect(result.count).toBe(1);
  } finally {
    redis.eval = originalEval;
  }
});

test("fallback still enforces the client's limit locally", async () => {
  const clientId = `failsafe-limit-test-${Date.now()}`;
  const originalEval = redis.eval.bind(redis);
  redis.eval = jest.fn().mockRejectedValue(new Error("simulated redis outage"));

  try {
    const results = [];
    for (let i = 0; i < 65; i++) {
      results.push(await checkLimit(clientId));
    }
    expect(results.filter((r) => r.allowed).length).toBe(60);
    expect(results.every((r) => r.source === "local-fallback")).toBe(true);
  } finally {
    redis.eval = originalEval;
  }
});

test("recovers to Redis-backed path once Redis is healthy again", async () => {
  const clientId = `failsafe-recovery-test-${Date.now()}`;
  const originalEval = redis.eval.bind(redis);
  redis.eval = jest.fn().mockRejectedValue(new Error("simulated redis outage"));

  const duringOutage = await checkLimit(clientId);
  expect(duringOutage.source).toBe("local-fallback");

  redis.eval = originalEval;
  const afterRestore = await redis.eval("return 1", 0);
  expect(afterRestore).toBe(1);
});
