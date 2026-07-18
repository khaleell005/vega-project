/**
 * requestLogger.ts — Fire-and-forget request logging to Postgres.
 *
 * Logs every /check result (allowed + denied) for analytics and billing.
 * Called without await so DB writes never block the response.
 * Invalidates analytics/usage caches after each write.
 */

import prisma from "../lib/prisma";
import { cacheInvalidate } from "../lib/cache";

interface LogRequestParams {
  clientId: string;
  status: string;
  responseTimeMs: number;
  source: string;
}

export async function logRequest({
  clientId,
  status,
  responseTimeMs,
  source,
}: LogRequestParams): Promise<void> {
  try {
    await prisma.request.create({
      data: { clientId, status, responseTimeMs, source },
    });

    await Promise.all([
      cacheInvalidate(`cache:analytics:${clientId}:*`),
      cacheInvalidate(`cache:usage:${clientId}`),
    ]);
  } catch (err) {
    console.error("[requestLogger] failed to log request:", (err as Error).message);
  }
}
