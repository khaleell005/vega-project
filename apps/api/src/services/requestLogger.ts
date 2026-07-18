/**
 * requestLogger.ts — Async request logging to Postgres.
 *
 * Every request to /check (both allowed and denied) is logged to the
 * `requests` table via Prisma. This provides:
 *   - Analytics data for the dashboard (total, allowed, denied, avg latency)
 *   - Billing data for usage-based pricing
 *   - Audit trail for compliance
 *
 * Design decisions:
 *   - The function is async but called fire-and-forget from server.ts
 *     (no await). This means the database write never blocks the response.
 *     If Postgres is down, the user still gets their fast answer — the log
 *     failure is silently swallowed.
 *   - After logging, the analytics and usage caches are invalidated via
 *     SCAN-based Redis key iteration (non-blocking, O(N) but bounded).
 *     This ensures the dashboard shows fresh data after each request.
 *
 * Cache invalidation pattern:
 *   cache:analytics:{clientId}:* — all range variants (10d, 15d, 30d)
 *   cache:usage:{clientId}       — the usage snapshot cache
 */

import prisma from "../lib/prisma";
import { cacheInvalidate } from "../lib/cache";

interface LogRequestParams {
  clientId: string;
  status: string;         // "allowed" or "denied"
  responseTimeMs: number; // latency of the check in milliseconds
  source: string;         // "redis" or "local-fallback"
}

export async function logRequest({
  clientId,
  status,
  responseTimeMs,
  source,
}: LogRequestParams): Promise<void> {
  try {
    await prisma.request.create({
      data: {
        clientId,
        status,
        responseTimeMs,
        source,
      },
    });

    // Invalidate caches so analytics and usage reflect the new data.
    // Uses SCAN (not KEYS) to avoid blocking Redis under load.
    await Promise.all([
      cacheInvalidate(`cache:analytics:${clientId}:*`),
      cacheInvalidate(`cache:usage:${clientId}`),
    ]);
  } catch (err) {
    const error = err as Error;
    console.error("[requestLogger] failed to log request:", error.message);
  }
}
