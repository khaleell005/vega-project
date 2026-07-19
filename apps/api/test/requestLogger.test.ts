jest.mock("../src/lib/prisma", () => ({
  __esModule: true,
  default: {
    request: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

jest.mock("../src/lib/cache", () => ({
  cacheInvalidate: jest.fn().mockResolvedValue(undefined),
}));

import prisma from "../src/lib/prisma";
import { cacheInvalidate } from "../src/lib/cache";

const mockPrisma = prisma as unknown as {
  request: {
    create: jest.Mock;
    findMany: jest.Mock;
  };
};

beforeEach(() => {
  jest.clearAllMocks();
});

import { logRequest, getRequestLogs } from "../src/services/requestLogger";

describe("logRequest", () => {
  test("creates request record and invalidates caches", async () => {
    mockPrisma.request.create.mockResolvedValue({});
    await logRequest({
      clientId: "c1",
      status: "allowed",
      responseTimeMs: 2.5,
      source: "redis",
    });

    expect(mockPrisma.request.create).toHaveBeenCalledWith({
      data: { clientId: "c1", status: "allowed", responseTimeMs: 2.5, source: "redis" },
    });
    expect(cacheInvalidate).toHaveBeenCalledWith("cache:analytics:c1:*");
    expect(cacheInvalidate).toHaveBeenCalledWith("cache:usage:c1");
  });

  test("swallows errors without throwing", async () => {
    mockPrisma.request.create.mockRejectedValue(new Error("db down"));
    await expect(
      logRequest({ clientId: "c1", status: "denied", responseTimeMs: 1, source: "redis" })
    ).resolves.toBeUndefined();
  });
});

describe("getRequestLogs", () => {
  test("returns serialized requests", async () => {
    const now = new Date("2024-06-15T10:00:00.000Z");
    mockPrisma.request.findMany.mockResolvedValue([
      { id: BigInt(1), status: "allowed", responseTimeMs: 2.5, source: "redis", createdAt: now },
    ]);

    const result = await getRequestLogs({ clientId: "c1", limit: 10 });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("1");
    expect(result[0].status).toBe("allowed");
  });

  test("passes where clause with filters", async () => {
    mockPrisma.request.findMany.mockResolvedValue([]);

    await getRequestLogs({
      clientId: "c1",
      limit: 5,
      status: "denied",
      source: "local-fallback",
      maxLatency: 3,
    });

    const call = mockPrisma.request.findMany.mock.calls[0][0];
    expect(call.where).toEqual({
      clientId: "c1",
      status: "denied",
      source: "local-fallback",
      responseTimeMs: { lte: 3 },
    });
    expect(call.take).toBe(5);
  });
});
