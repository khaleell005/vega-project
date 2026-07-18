/**
 * analytics.ts — Historical analytics with Redis caching.
 *
 * Provides getClientAnalytics(clientId, range) which queries Postgres for:
 *   - Total request count (aggregate)
 *   - Allowed/denied breakdown (two separate COUNT queries)
 *   - Average response time
 *   - Daily trend (zero-filled via generate_series so days with no requests
 *     still appear in the chart — important for UX)
 *
 * Caching:
 *   Results are cached in Redis for 30 seconds (ANALYTICS_CACHE_TTL).
 *   This is critical because the analytics query is expensive — it runs
 *   three separate Prisma queries plus a raw SQL query with generate_series,
 *   LEFT JOIN, and GROUP BY. Without caching, every dashboard poll would
 *   hammer Postgres with these heavy aggregations.
 *
 *   Cache key format: cache:analytics:{clientId}:{range}
 *   Cache is invalidated on each logged request (see requestLogger.ts).
 *
 * Database indexing:
 *   The queries leverage two composite indexes:
 *     idx_requests_client_created — (client_id, created_at DESC)
 *     idx_requests_client_status_created — (client_id, status, created_at DESC)
 *   These cover the WHERE clauses used by aggregate, count, and the raw
 *   trend query, avoiding full table scans.
 */

import prisma from "../lib/prisma";
import { cacheGet, cacheSet } from "../lib/cache";

/** Allowed time ranges for analytics queries. */
export const ALLOWED_RANGES: Record<string, number> = {
  "10d": 10,
  "15d": 15,
  "30d": 30,
};

/** Validate that a range string is one of the supported values. */
export function isValidRange(range: string): boolean {
  return Object.prototype.hasOwnProperty.call(ALLOWED_RANGES, range);
}

/** A single day's data point in the trend chart. */
export interface TrendPoint {
  date: string;              // "YYYY-MM-DD"
  requestCount: number;      // total requests on this day
  avgResponseTimeMs: number; // average response time on this day
}

/** Full analytics result returned by getClientAnalytics. */
export interface AnalyticsResult {
  clientId: string;
  range: string;
  totalRequests: number;
  allowedRequests: number;
  deniedRequests: number;
  avgResponseTimeMs: number;
  trend: TrendPoint[];
}

/** Cache TTL — 30 seconds balances freshness vs. Postgres load. */
const ANALYTICS_CACHE_TTL = 30;

export async function getClientAnalytics(
  clientId: string,
  range: string
): Promise<AnalyticsResult> {
  // Check cache first — avoids repeated expensive Postgres queries.
  const cacheKey = `cache:analytics:${clientId}:${range}`;
  const cached = await cacheGet<AnalyticsResult>(cacheKey);
  if (cached) return cached;

  const days = ALLOWED_RANGES[range];
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Query 1: Aggregate stats (total count + avg response time).
  // Uses the (clientId, createdAt) composite index.
  const summary = await prisma.request.aggregate({
    where: {
      clientId,
      createdAt: { gte: since },
    },
    _count: { id: true },
    _avg: { responseTimeMs: true },
  });

  // Query 2: Count allowed requests.
  // Uses the (clientId, status, createdAt) composite index.
  const allowed = await prisma.request.count({
    where: {
      clientId,
      status: "allowed",
      createdAt: { gte: since },
    },
  });

  // Query 3: Count denied requests.
  const denied = await prisma.request.count({
    where: {
      clientId,
      status: "denied",
      createdAt: { gte: since },
    },
  });

  // Query 4: Daily trend with zero-filling.
  // Uses PostgreSQL's generate_series to create a row for every day in the
  // range, then LEFT JOINs against the requests table. Days with no requests
  // get count=0 and avg=0, so the chart always shows the full time range
  // instead of gaps.
  const trendRaw = await prisma.$queryRaw<
    { date: Date; request_count: bigint; avg_response_time_ms: number }[]
  >`
    SELECT
      day::date AS date,
      COALESCE(COUNT(r.id), 0) AS request_count,
      COALESCE(AVG(r.response_time_ms), 0) AS avg_response_time_ms
    FROM generate_series(
           ${since}::date,
           now()::date,
           '1 day'
         ) AS day
    LEFT JOIN requests r
      ON r.client_id = ${clientId}
      AND r.created_at::date = day::date
    GROUP BY day
    ORDER BY day ASC
  `;

  const result: AnalyticsResult = {
    clientId,
    range,
    totalRequests: Number(summary._count.id),
    allowedRequests: allowed,
    deniedRequests: denied,
    avgResponseTimeMs: Number(
      parseFloat(String(summary._avg.responseTimeMs || 0)).toFixed(2)
    ),
    trend: trendRaw.map((row) => ({
      date: row.date instanceof Date
        ? row.date.toISOString().split("T")[0]
        : String(row.date).split("T")[0],
      requestCount: Number(row.request_count),
      avgResponseTimeMs: Number(
        parseFloat(String(row.avg_response_time_ms)).toFixed(2)
      ),
    })),
  };

  // Cache the result to avoid re-running these queries on every dashboard poll.
  await cacheSet(cacheKey, result, ANALYTICS_CACHE_TTL);

  return result;
}
