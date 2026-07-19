import { cacheOrFetch } from "../../src/helpers/cache";

jest.mock("../../src/lib/cache", () => ({
  cacheGet: jest.fn(),
  cacheSet: jest.fn(),
}));

import { cacheGet, cacheSet } from "../../src/lib/cache";

const mockCacheGet = cacheGet as jest.MockedFunction<typeof cacheGet>;
const mockCacheSet = cacheSet as jest.MockedFunction<typeof cacheSet>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("cacheOrFetch", () => {
  test("returns cached value on hit", async () => {
    mockCacheGet.mockResolvedValue({ data: "cached" });

    const result = await cacheOrFetch("key:1", 30, jest.fn());

    expect(result).toEqual({ data: "cached" });
    expect(mockCacheGet).toHaveBeenCalledWith("key:1");
    expect(mockCacheSet).not.toHaveBeenCalled();
  });

  test("calls fetcher and caches on miss", async () => {
    mockCacheGet.mockResolvedValue(null);
    mockCacheSet.mockResolvedValue();
    const fetcher = jest.fn().mockResolvedValue({ data: "fresh" });

    const result = await cacheOrFetch("key:2", 60, fetcher);

    expect(result).toEqual({ data: "fresh" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(mockCacheSet).toHaveBeenCalledWith("key:2", { data: "fresh" }, 60);
  });

  test("propagates fetcher errors", async () => {
    mockCacheGet.mockResolvedValue(null);
    const fetcher = jest.fn().mockRejectedValue(new Error("db down"));

    await expect(cacheOrFetch("key:3", 30, fetcher)).rejects.toThrow("db down");
    expect(mockCacheSet).not.toHaveBeenCalled();
  });
});
