/**
 * analytics.test.ts — Analytics aggregation verification tests.
 *
 * PROVES: The analytics queries (src/analytics.ts) return correct numbers
 * against known, controlled data — independent of whatever traffic has
 * accumulated in the table from manual testing.
 *
 * WHY THIS MATTERS:
 *   The dashboard shows total requests, allowed/denied breakdown, average
 *   response time, and a daily trend chart. If these numbers are wrong,
 *   clients will see incorrect billing data and usage graphs. These tests
 *   seed exactly known data, then verify the aggregation queries return
 *   the expected results.
 *
 * TEST APPROACH:
 *   - Seeds 3 rows for "today" (2 allowed, 1 denied) and 1 row 20 days ago
 *   - Tests 10d range (should see only today's 3 rows)
 *   - Tests 30d range (should see all 4 rows)
 *   - Verifies trend series is zero-filled (days with no data → count=0)
 *   - Verifies unknown clients return clean zeros (no errors)
 *
 * CLEANUP:
 *   Deletes seeded data in afterAll to avoid polluting the real table.
 *
 * REQUIRES: Running Postgres with schema applied (npm run migrate).
 */

import prisma from "../src/lib/prisma";
import { getClientAnalytics } from "../src/services/analytics";

/**
 * Unique client ID for this test suite. Using a timestamp ensures
 * isolation from other tests and manual traffic.
 */
const TEST_CLIENT_ID = `analytics-test-${Date.now()}`;

/**
 * Seed known data before all tests run.
 *
 * Inserts exactly 4 rows:
 *   - 3 rows for "now" (2 allowed, 1 denied, avg response times 1.50, 2.50, 0.90)
 *   - 1 row for 20 days ago (allowed, response time 5.00)
 *
 * The 20-day-old row is outside the 10d and 15d ranges but inside 30d,
 * allowing us to verify that range filtering actually works.
 */
beforeAll(async () => {
  const now = new Date();
  const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);

  await prisma.request.createMany({
    data: [
      {
        clientId: TEST_CLIENT_ID,
        status: "allowed",
        responseTimeMs: 1.5,
        source: "redis",
        createdAt: now,
      },
      {
        clientId: TEST_CLIENT_ID,
        status: "allowed",
        responseTimeMs: 2.5,
        source: "redis",
        createdAt: now,
      },
      {
        clientId: TEST_CLIENT_ID,
        status: "denied",
        responseTimeMs: 0.9,
        source: "redis",
        createdAt: now,
      },
      {
        clientId: TEST_CLIENT_ID,
        status: "allowed",
        responseTimeMs: 5.0,
        source: "redis",
        createdAt: twentyDaysAgo,
      },
    ],
  });
});

/**
 * Clean up seeded data and disconnect Prisma after all tests complete.
 */
afterAll(async () => {
  await prisma.request.deleteMany({
    where: { clientId: TEST_CLIENT_ID },
  });
  await prisma.$disconnect();
});

/**
 * Test 1: 10-day range includes only today's rows.
 *
 * The 20-day-old row should be excluded from the 10d range.
 * Summary should show: 3 total, 2 allowed, 1 denied.
 * Average response time: (1.50 + 2.50 + 0.90) / 3 ≈ 1.63ms.
 */
test("10-day range includes only today's rows", async () => {
  const result = await getClientAnalytics(TEST_CLIENT_ID, "10d");

  expect(result.totalRequests).toBe(3);
  expect(result.allowedRequests).toBe(2);
  expect(result.deniedRequests).toBe(1);
  // (1.50 + 2.50 + 0.90) / 3 = 1.6333... → rounded to 2 decimal places
  expect(result.avgResponseTimeMs).toBeCloseTo(1.63, 1);
});

/**
 * Test 2: 30-day range includes the older row too.
 *
 * The 20-day-old row falls within the 30d range, so total should be 4.
 */
test("30-day range includes the older row too", async () => {
  const result = await getClientAnalytics(TEST_CLIENT_ID, "30d");
  expect(result.totalRequests).toBe(4);
});

/**
 * Test 3: Trend series is zero-filled for days with no traffic.
 *
 * The trend array should have exactly 11 points (today + 10 prior days).
 * Only today should have non-zero counts; the other 10 days should be
 * zero-filled. This is critical for the dashboard chart — without
 * zero-filling, the chart would show gaps instead of a continuous line.
 */
test("trend series is zero-filled for days with no traffic", async () => {
  const result = await getClientAnalytics(TEST_CLIENT_ID, "10d");

  // 11 data points: today plus the 10 prior days.
  expect(result.trend.length).toBe(11);

  const emptyDays = result.trend.filter((d) => d.requestCount === 0);
  const nonEmptyDays = result.trend.filter((d) => d.requestCount > 0);

  // Only today has data.
  expect(nonEmptyDays.length).toBe(1);
  // The other 10 days are zero-filled.
  expect(emptyDays.length).toBe(10);
});

/**
 * Test 4: Unknown client returns clean zeros, not an error.
 *
 * If a client has never made a request, the analytics endpoint should
 * return a valid result with all zeros — not throw an error or return
 * null. The trend should be zero-filled for every day in the range.
 */
test("unknown client returns clean zeros, not an error", async () => {
  const result = await getClientAnalytics(`nonexistent-${Date.now()}`, "10d");
  expect(result.totalRequests).toBe(0);
  expect(result.trend.every((d) => d.requestCount === 0)).toBe(true);
});
