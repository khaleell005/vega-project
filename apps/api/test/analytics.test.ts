/**
 * analytics.test.ts — Verifies analytics queries against known seeded data.
 *
 * Seeds 4 rows (3 today, 1 twenty days ago) and checks:
 *   - 10d range includes only today's rows
 *   - 30d range includes the older row
 *   - Trend series is zero-filled for empty days
 *   - Unknown clients return clean zeros
 *
 * REQUIRES: Running Postgres with schema applied.
 */

import prisma from "../src/lib/prisma";
import { getClientAnalytics } from "../src/services/analytics";

const TEST_CLIENT_ID = `analytics-test-${Date.now()}`;

beforeAll(async () => {
  const now = new Date();
  const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);

  await prisma.request.createMany({
    data: [
      { clientId: TEST_CLIENT_ID, status: "allowed", responseTimeMs: 1.5, source: "redis", createdAt: now },
      { clientId: TEST_CLIENT_ID, status: "allowed", responseTimeMs: 2.5, source: "redis", createdAt: now },
      { clientId: TEST_CLIENT_ID, status: "denied", responseTimeMs: 0.9, source: "redis", createdAt: now },
      { clientId: TEST_CLIENT_ID, status: "allowed", responseTimeMs: 5.0, source: "redis", createdAt: twentyDaysAgo },
    ],
  });
});

afterAll(async () => {
  await prisma.request.deleteMany({ where: { clientId: TEST_CLIENT_ID } });
  await prisma.$disconnect();
});

test("10-day range includes only today's rows", async () => {
  const result = await getClientAnalytics(TEST_CLIENT_ID, "10d");
  expect(result.totalRequests).toBe(3);
  expect(result.allowedRequests).toBe(2);
  expect(result.deniedRequests).toBe(1);
  expect(result.avgResponseTimeMs).toBeCloseTo(1.63, 1);
});

test("30-day range includes the older row too", async () => {
  const result = await getClientAnalytics(TEST_CLIENT_ID, "30d");
  expect(result.totalRequests).toBe(4);
});

test("trend series is zero-filled for days with no traffic", async () => {
  const result = await getClientAnalytics(TEST_CLIENT_ID, "10d");
  expect(result.trend.length).toBe(11);
  expect(result.trend.filter((d) => d.requestCount === 0).length).toBe(10);
  expect(result.trend.filter((d) => d.requestCount > 0).length).toBe(1);
});

test("trend includes allowedCount and deniedCount per day", async () => {
  const result = await getClientAnalytics(TEST_CLIENT_ID, "10d");
  const today = result.trend.find((d) => d.requestCount > 0);
  expect(today).toBeDefined();
  expect(today!.allowedCount).toBe(2);
  expect(today!.deniedCount).toBe(1);
});

test("unknown client returns clean zeros", async () => {
  const result = await getClientAnalytics(`nonexistent-${Date.now()}`, "10d");
  expect(result.totalRequests).toBe(0);
  expect(result.trend.every((d) => d.requestCount === 0)).toBe(true);
});
