jest.mock("../src/lib/prisma", () => ({
  __esModule: true,
  default: {
    request: {
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    $queryRaw: jest.fn(),
  },
}));

jest.mock("../src/lib/cache", () => ({
  cacheGet: jest.fn().mockResolvedValue(null),
  cacheSet: jest.fn().mockResolvedValue(undefined),
}));

import prisma from "../src/lib/prisma";
import { cacheGet, cacheSet } from "../src/lib/cache";

const mockPrisma = prisma as unknown as {
  request: {
    count: jest.Mock;
    aggregate: jest.Mock;
  };
  $queryRaw: jest.Mock;
};

const mockCacheGet = cacheGet as jest.MockedFunction<typeof cacheGet>;
const mockCacheSet = cacheSet as jest.MockedFunction<typeof cacheSet>;

beforeEach(() => {
  jest.clearAllMocks();
});

import { getClientAnalytics, isValidRange, ALLOWED_RANGES } from "../src/services/analytics";

describe("isValidRange", () => {
  test("accepts valid ranges", () => {
    expect(isValidRange("10d")).toBe(true);
    expect(isValidRange("15d")).toBe(true);
    expect(isValidRange("30d")).toBe(true);
  });

  test("rejects invalid ranges", () => {
    expect(isValidRange("5d")).toBe(false);
    expect(isValidRange("")).toBe(false);
    expect(isValidRange("30D")).toBe(false);
  });
});

describe("ALLOWED_RANGES", () => {
  test("maps to correct day counts", () => {
    expect(ALLOWED_RANGES["10d"]).toBe(10);
    expect(ALLOWED_RANGES["15d"]).toBe(15);
    expect(ALLOWED_RANGES["30d"]).toBe(30);
  });
});

describe("getClientAnalytics", () => {
  const mockNow = new Date("2024-06-15T12:00:00.000Z");

  beforeEach(() => {
    jest.spyOn(Date, "now").mockReturnValue(mockNow.getTime());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("returns cached result on hit", async () => {
    const cached = { clientId: "c1", range: "10d", totalRequests: 5, trend: [] };
    mockCacheGet.mockResolvedValue(cached);

    const result = await getClientAnalytics("c1", "10d");
    expect(result).toEqual(cached);
    expect(mockPrisma.request.count).not.toHaveBeenCalled();
  });

  test("fetches from DB on cache miss", async () => {
    mockCacheGet.mockResolvedValue(null);
    mockPrisma.request.count.mockResolvedValue(0);
    mockPrisma.request.aggregate.mockResolvedValue({ _avg: { responseTimeMs: 0 } });
    mockPrisma.$queryRaw.mockResolvedValue([]);

    const result = await getClientAnalytics("c1", "10d");
    expect(result.clientId).toBe("c1");
    expect(result.totalRequests).toBe(0);
    expect(result.trend).toEqual([]);
    expect(mockCacheSet).toHaveBeenCalled();
  });

  test("computes total from allowed + denied", async () => {
    mockCacheGet.mockResolvedValue(null);
    mockPrisma.request.count
      .mockResolvedValueOnce(8)
      .mockResolvedValueOnce(2);
    mockPrisma.request.aggregate.mockResolvedValue({ _avg: { responseTimeMs: 3.5 } });
    mockPrisma.$queryRaw.mockResolvedValue([]);

    const result = await getClientAnalytics("c1", "10d");
    expect(result.totalRequests).toBe(10);
    expect(result.allowedRequests).toBe(8);
    expect(result.deniedRequests).toBe(2);
  });

  test("formats trend dates and numbers", async () => {
    mockCacheGet.mockResolvedValue(null);
    mockPrisma.request.count.mockResolvedValue(0);
    mockPrisma.request.aggregate.mockResolvedValue({ _avg: { responseTimeMs: 0 } });
    mockPrisma.$queryRaw.mockResolvedValue([
      {
        date: new Date("2024-06-15T00:00:00.000Z"),
        request_count: BigInt(5),
        allowed_count: BigInt(4),
        denied_count: BigInt(1),
        avg_response_time_ms: 2.345,
      },
    ]);

    const result = await getClientAnalytics("c1", "10d");
    expect(result.trend).toHaveLength(1);
    expect(result.trend[0].date).toBe("2024-06-15");
    expect(result.trend[0].requestCount).toBe(5);
    expect(result.trend[0].allowedCount).toBe(4);
    expect(result.trend[0].deniedCount).toBe(1);
    expect(result.trend[0].avgResponseTimeMs).toBe(2.35);
  });
});
