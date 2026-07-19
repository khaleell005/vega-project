import { cacheGet, cacheSet } from "../lib/cache";

export async function cacheOrFetch<T>(
  cacheKey: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>
): Promise<T> {
  const cached = await cacheGet<T>(cacheKey);
  if (cached) return cached;

  const result = await fetcher();
  await cacheSet(cacheKey, result, ttlSeconds);
  return result;
}
