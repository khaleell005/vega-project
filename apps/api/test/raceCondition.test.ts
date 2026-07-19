/**
 * raceCondition.test.ts — Proves the Lua script is atomic under concurrency.
 *
 * Fires 300 concurrent eval calls against a 60/min limit.
 * If atomic, exactly 60 are allowed — any race would allow more.
 *
 * REQUIRES: Running Redis instance.
 */

import fs from "fs";
import path from "path";
import redis from "../src/lib/redis";
import { DEFAULT_LIMIT_PER_MINUTE } from "../src/config/defaults";

const luaScript = fs.readFileSync(
  path.join(__dirname, "..", "src", "lua", "rateLimit.lua"),
  "utf8"
);

const WINDOW_SECONDS = 60;

async function evalRateLimit(
  clientId: string,
  limit: number
): Promise<{ allowed: boolean; count: number; limit: number }> {
  const windowBucket = Math.floor(Date.now() / (WINDOW_SECONDS * 1000));
  const key = `ratelimit:${clientId}:${windowBucket}`;

  const [allowed, count] = (await redis.eval(
    luaScript, 1, key, limit, WINDOW_SECONDS
  )) as [number, number];

  return { allowed: allowed === 1, count, limit };
}

afterAll(async () => {
  await redis.quit();
});

test("exactly `limit` requests allowed when far more arrive concurrently", async () => {
  const clientId = `race-test-${Date.now()}`;
  const CONCURRENT_REQUESTS = 300;

  const results = await Promise.all(
    Array.from({ length: CONCURRENT_REQUESTS }, () =>
      evalRateLimit(clientId, DEFAULT_LIMIT_PER_MINUTE)
    )
  );

  const allowedCount = results.filter((r) => r.allowed).length;
  expect(allowedCount).toBe(DEFAULT_LIMIT_PER_MINUTE);
  expect(results.filter((r) => !r.allowed).length).toBe(
    CONCURRENT_REQUESTS - DEFAULT_LIMIT_PER_MINUTE
  );
});

test("two different clients' limits never interfere", async () => {
  const clientA = `race-test-a-${Date.now()}`;
  const clientB = `race-test-b-${Date.now()}`;

  const [resultsA, resultsB] = await Promise.all([
    Promise.all(
      Array.from({ length: 80 }, () => evalRateLimit(clientA, DEFAULT_LIMIT_PER_MINUTE))
    ),
    Promise.all(
      Array.from({ length: 80 }, () => evalRateLimit(clientB, DEFAULT_LIMIT_PER_MINUTE))
    ),
  ]);

  expect(resultsA.filter((r) => r.allowed).length).toBe(DEFAULT_LIMIT_PER_MINUTE);
  expect(resultsB.filter((r) => r.allowed).length).toBe(DEFAULT_LIMIT_PER_MINUTE);
});
