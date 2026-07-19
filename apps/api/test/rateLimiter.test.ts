jest.mock("../src/lib/redis", () => ({
  __esModule: true,
  default: {
    eval: jest.fn(),
    get: jest.fn(),
    on: jest.fn(),
  },
}));

jest.mock("../src/config/clientConfig", () => ({
  getClientLimit: jest.fn().mockReturnValue(60),
}));

jest.mock("../src/helpers/cache", () => ({
  cacheOrFetch: jest.fn(),
}));

import redis from "../src/lib/redis";
import { getClientLimit } from "../src/config/clientConfig";
import { cacheOrFetch } from "../src/helpers/cache";

const mockRedis = redis as unknown as {
  eval: jest.Mock;
  get: jest.Mock;
  on: jest.Mock;
};
const mockCacheOrFetch = cacheOrFetch as jest.MockedFunction<typeof cacheOrFetch>;
const mockGetClientLimit = getClientLimit as jest.MockedFunction<typeof getClientLimit>;

beforeEach(() => {
  jest.clearAllMocks();
  mockGetClientLimit.mockReturnValue(60);
});

import { checkLimit, getCurrentUsage } from "../src/services/rateLimiter";

describe("checkLimit", () => {
  test("allows request when under limit (redis path)", async () => {
    mockRedis.eval.mockResolvedValue([1, 1]);
    const result = await checkLimit("client-a");
    expect(result.allowed).toBe(true);
    expect(result.source).toBe("redis");
    expect(result.count).toBe(1);
  });

  test("denies request when at limit (redis path)", async () => {
    mockRedis.eval.mockResolvedValue([0, 60]);
    const result = await checkLimit("client-a");
    expect(result.allowed).toBe(false);
    expect(result.source).toBe("redis");
    expect(result.count).toBe(60);
  });

  test("uses configured limit from clientConfig", async () => {
    mockGetClientLimit.mockReturnValue(200);
    mockRedis.eval.mockResolvedValue([1, 1]);
    await checkLimit("premium-client");
    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      expect.stringContaining("premium-client:"),
      200,
      60
    );
  });
});

describe("getCurrentUsage", () => {
  test("returns count and limit from cache on hit", async () => {
    const cached = { count: 30, limit: 60, windowSecondsRemaining: 45 };
    mockCacheOrFetch.mockResolvedValue(cached);

    const result = await getCurrentUsage("client-a");
    expect(result).toEqual(cached);
  });

  test("fetches from redis on cache miss", async () => {
    mockCacheOrFetch.mockImplementation(async (_key, _ttl, fetcher) => fetcher());
    mockRedis.get.mockResolvedValue("25");

    const result = await getCurrentUsage("client-a");
    expect(result.count).toBe(25);
    expect(result.limit).toBe(60);
    expect(result.windowSecondsRemaining).toBeGreaterThanOrEqual(0);
    expect(result.windowSecondsRemaining).toBeLessThanOrEqual(60);
  });

  test("returns 0 count when key missing in redis", async () => {
    mockCacheOrFetch.mockImplementation(async (_key, _ttl, fetcher) => fetcher());
    mockRedis.get.mockResolvedValue(null);

    const result = await getCurrentUsage("new-client");
    expect(result.count).toBe(0);
  });
});
