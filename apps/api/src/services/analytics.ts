import prisma from "../lib/prisma";
import { cacheOrFetch } from "../helpers/cache";
import { toDateString, toFixed } from "../helpers/format";

export const ALLOWED_RANGES: Record<string, number> = {
  "10d": 10,
  "15d": 15,
  "30d": 30,
};

export function isValidRange(range: string): boolean {
  return Object.prototype.hasOwnProperty.call(ALLOWED_RANGES, range);
}

export interface TrendPoint {
  date: string;
  requestCount: number;
  allowedCount: number;
  deniedCount: number;
  avgResponseTimeMs: number;
}

export interface AnalyticsResult {
  clientId: string;
  range: string;
  totalRequests: number;
  allowedRequests: number;
  deniedRequests: number;
  avgResponseTimeMs: number;
  trend: TrendPoint[];
}

const ANALYTICS_CACHE_TTL = 30;

export async function getClientAnalytics(
  clientId: string,
  range: string
): Promise<AnalyticsResult> {
  return cacheOrFetch(
    `cache:analytics:${clientId}:${range}`,
    ANALYTICS_CACHE_TTL,
    () => fetchAnalytics(clientId, range)
  );
}

async function fetchAnalytics(clientId: string, range: string): Promise<AnalyticsResult> {
  const days = ALLOWED_RANGES[range];
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [allowed, denied, avgResult] = await Promise.all([
    prisma.request.count({
      where: { clientId, status: "allowed", createdAt: { gte: since } },
    }),
    prisma.request.count({
      where: { clientId, status: "denied", createdAt: { gte: since } },
    }),
    prisma.request.aggregate({
      where: { clientId, createdAt: { gte: since } },
      _avg: { responseTimeMs: true },
    }),
  ]);

  const trendRaw = await prisma.$queryRaw<
    {
      date: Date;
      request_count: bigint;
      allowed_count: bigint;
      denied_count: bigint;
      avg_response_time_ms: number;
    }[]
  >`
    SELECT
      day::date AS date,
      COALESCE(SUM(CASE WHEN r.id IS NOT NULL THEN 1 ELSE 0 END), 0) AS request_count,
      COALESCE(SUM(CASE WHEN r.status = 'allowed' THEN 1 ELSE 0 END), 0) AS allowed_count,
      COALESCE(SUM(CASE WHEN r.status = 'denied' THEN 1 ELSE 0 END), 0) AS denied_count,
      COALESCE(AVG(r.response_time_ms), 0) AS avg_response_time_ms
    FROM generate_series(
             ${since}::date, now()::date, '1 day'
           ) AS day
    LEFT JOIN requests r
      ON r.client_id = ${clientId} AND r.created_at::date = day::date
    GROUP BY day
    ORDER BY day ASC
  `;

  return {
    clientId,
    range,
    totalRequests: allowed + denied,
    allowedRequests: allowed,
    deniedRequests: denied,
    avgResponseTimeMs: toFixed(avgResult._avg.responseTimeMs),
    trend: trendRaw.map((row) => ({
      date: toDateString(row.date),
      requestCount: Number(row.request_count),
      allowedCount: Number(row.allowed_count),
      deniedCount: Number(row.denied_count),
      avgResponseTimeMs: toFixed(row.avg_response_time_ms),
    })),
  };
}
