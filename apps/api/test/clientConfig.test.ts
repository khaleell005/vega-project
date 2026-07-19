jest.mock("../src/lib/prisma", () => ({
  __esModule: true,
  default: {
    clientConfig: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

jest.mock("../src/lib/cache", () => ({
  cacheGet: jest.fn().mockResolvedValue(null),
  cacheSet: jest.fn().mockResolvedValue(undefined),
  cacheInvalidate: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../src/helpers/cache", () => ({
  cacheOrFetch: jest.fn(),
}));

import prisma from "../src/lib/prisma";
import { cacheInvalidate } from "../src/lib/cache";
import { cacheOrFetch } from "../src/helpers/cache";

const mockPrisma = prisma as unknown as {
  clientConfig: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    upsert: jest.Mock;
    delete: jest.Mock;
  };
};

const mockCacheOrFetch = cacheOrFetch as jest.MockedFunction<typeof cacheOrFetch>;
const mockCacheInvalidate = cacheInvalidate as jest.MockedFunction<typeof cacheInvalidate>;

import {
  refreshClientCache,
  getClientLimit,
  getClientDisplayName,
  listClients,
  getClient,
  upsertClient,
  deleteClient,
  DEFAULT_LIMIT_PER_MINUTE,
} from "../src/config/clientConfig";

beforeEach(() => {
  jest.clearAllMocks();
});

describe("getClientLimit", () => {
  test("returns default limit for unknown client", async () => {
    mockPrisma.clientConfig.findMany.mockResolvedValue([]);
    await refreshClientCache();
    expect(getClientLimit("nonexistent")).toBe(DEFAULT_LIMIT_PER_MINUTE);
  });

  test("returns configured limit after refresh", async () => {
    mockPrisma.clientConfig.findMany.mockResolvedValue([
      { id: "client-a", limitPerMinute: 200, displayName: "A" },
    ]);
    await refreshClientCache();
    expect(getClientLimit("client-a")).toBe(200);
  });
});

describe("getClientDisplayName", () => {
  test("returns null for unknown client", async () => {
    mockPrisma.clientConfig.findMany.mockResolvedValue([]);
    await refreshClientCache();
    expect(getClientDisplayName("unknown")).toBeNull();
  });

  test("returns display name after refresh", async () => {
    mockPrisma.clientConfig.findMany.mockResolvedValue([
      { id: "client-x", limitPerMinute: 100, displayName: "X Corp" },
    ]);
    await refreshClientCache();
    expect(getClientDisplayName("client-x")).toBe("X Corp");
  });
});

describe("listClients", () => {
  test("fetches from DB and serializes dates", async () => {
    const now = new Date("2024-06-15T10:00:00.000Z");
    mockPrisma.clientConfig.findMany.mockResolvedValue([
      { id: "a", limitPerMinute: 100, displayName: "A", createdAt: now, updatedAt: now },
    ]);
    mockCacheOrFetch.mockImplementation(async (_key, _ttl, fetcher) => fetcher());

    const result = await listClients();
    expect(result).toHaveLength(1);
    expect(result[0].createdAt).toBe("2024-06-15T10:00:00.000Z");
  });
});

describe("getClient", () => {
  test("returns null for nonexistent id", async () => {
    mockPrisma.clientConfig.findUnique.mockResolvedValue(null);
    expect(await getClient("nope")).toBeNull();
  });

  test("returns serialized client", async () => {
    const now = new Date("2024-06-15T10:00:00.000Z");
    mockPrisma.clientConfig.findUnique.mockResolvedValue({
      id: "c1", limitPerMinute: 500, displayName: "C1", createdAt: now, updatedAt: now,
    });
    const result = await getClient("c1");
    expect(result?.id).toBe("c1");
    expect(result?.limitPerMinute).toBe(500);
  });
});

describe("upsertClient", () => {
  test("creates client and refreshes cache", async () => {
    const now = new Date("2024-06-15T10:00:00.000Z");
    mockPrisma.clientConfig.upsert.mockResolvedValue({
      id: "new", limitPerMinute: 300, displayName: "New", createdAt: now, updatedAt: now,
    });
    mockPrisma.clientConfig.findMany.mockResolvedValue([]);

    const result = await upsertClient({ id: "new", limitPerMinute: 300, displayName: "New" });
    expect(result.id).toBe("new");
    expect(mockPrisma.clientConfig.upsert).toHaveBeenCalled();
    expect(mockCacheInvalidate).toHaveBeenCalled();
  });
});

describe("deleteClient", () => {
  test("returns true and refreshes cache", async () => {
    mockPrisma.clientConfig.delete.mockResolvedValue(undefined);
    mockPrisma.clientConfig.findMany.mockResolvedValue([]);

    expect(await deleteClient("to-delete")).toBe(true);
    expect(mockPrisma.clientConfig.delete).toHaveBeenCalledWith({ where: { id: "to-delete" } });
  });

  test("returns false when client not found", async () => {
    mockPrisma.clientConfig.delete.mockRejectedValue(new Error("RecordNotFound"));
    expect(await deleteClient("ghost")).toBe(false);
  });
});
