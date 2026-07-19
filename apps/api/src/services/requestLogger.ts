/**
 * requestLogger.ts — Fire-and-forget request logging to Postgres.
 *
 * Logs every /check result (allowed + denied) for analytics and billing.
 * Called without await so DB writes never block the response.
 * Invalidates analytics/usage caches after each write.
 */

import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { cacheInvalidate } from "../lib/cache";

type RequestSource = "redis" | "local-fallback";

interface LogRequestParams {
  clientId: string;
  status: "allowed" | "denied";
  responseTimeMs: number;
  source: RequestSource;
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

interface GetRequestLogsParams {
  clientId: string;
  limit: number;
  status?: "allowed" | "denied";
  source?: RequestSource;
  maxLatency?: number;
}

export async function getRequestLogs({
  clientId,
  limit,
  status,
  source,
  maxLatency,
}: GetRequestLogsParams) {
  const where: Prisma.RequestWhereInput = { clientId };
  if (status) where.status = status;
  if (source) where.source = source;
  if (maxLatency !== undefined && !isNaN(maxLatency)) {
    where.responseTimeMs = { lte: maxLatency };
  }

  const requests = await prisma.request.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      status: true,
      responseTimeMs: true,
      source: true,
      createdAt: true,
    },
  });

  return requests.map((r) => ({
    id: String(r.id),
    status: r.status,
    responseTimeMs: Number(r.responseTimeMs),
    source: r.source,
    createdAt: r.createdAt.toISOString(),
  }));
}
