import fs from "fs";
import path from "path";
import CircuitBreaker from "opossum";
import redis from "../lib/redis";
import { getClientLimit } from "../config/clientConfig";
import { cacheOrFetch } from "../helpers/cache";
import { getWindowBucket, getWindowKey, getSecondsRemaining, WINDOW_SECONDS } from "../helpers/window";

export interface LimitResult {
  allowed: boolean;
  count: number;
  limit: number;
  source: "redis" | "local-fallback";
}

export interface UsageResult {
  count: number;
  limit: number;
  windowSecondsRemaining: number;
}

const luaScript = fs.readFileSync(
  path.join(__dirname, "../lua/rateLimit.lua"),
  "utf8"
);

const localCounters = new Map<string, number>();

function localFallbackCheck(clientId: string, limit: number): LimitResult {
  const key = `${clientId}:${getWindowBucket()}`;
  const current = (localCounters.get(key) || 0) + 1;
  localCounters.set(key, current);

  if (localCounters.size > 10000) localCounters.clear();

  return { allowed: current <= limit, count: current, limit, source: "local-fallback" };
}

async function redisCheck(clientId: string, limit: number): Promise<LimitResult> {
  const key = getWindowKey(clientId);
  const [allowed, count] = (await redis.eval(
    luaScript, 1, key, limit, WINDOW_SECONDS
  )) as [number, number];

  return { allowed: allowed === 1, count, limit, source: "redis" };
}

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

export async function checkLimit(clientId: string): Promise<LimitResult> {
  const limit = getClientLimit(clientId);
  return breaker.fire(clientId, limit) as Promise<LimitResult>;
}

const USAGE_CACHE_TTL = 5;

export async function getCurrentUsage(clientId: string): Promise<UsageResult> {
  return cacheOrFetch(`cache:usage:${clientId}`, USAGE_CACHE_TTL, async () => {
    const limit = getClientLimit(clientId);
    const nowMs = Date.now();
    const key = getWindowKey(clientId);

    let count = 0;
    try {
      const raw = await redis.get(key);
      count = raw ? parseInt(raw, 10) : 0;
    } catch (err) {
      console.error("[getCurrentUsage] redis read failed:", (err as Error).message);
    }

    return { count, limit, windowSecondsRemaining: getSecondsRemaining(nowMs) };
  });
}
