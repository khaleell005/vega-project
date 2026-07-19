import prisma from "../lib/prisma";
import { cacheInvalidate } from "../lib/cache";
import { buildRequestWhere } from "../helpers/query";
import { serializeRequest } from "../helpers/format";

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

export async function getRequestLogs(params: GetRequestLogsParams) {
  const where = buildRequestWhere(params);

  const requests = await prisma.request.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: params.limit,
    select: {
      id: true,
      status: true,
      responseTimeMs: true,
      source: true,
      createdAt: true,
    },
  });

  return requests.map(serializeRequest);
}
