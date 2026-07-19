/**
 * clientConfig.ts — DB-backed per-client rate-limit configuration.
 *
 * Limits are stored in the `client_configs` PostgreSQL table.
 * Hot path reads from an in-memory Map (refreshed every 60s) so
 * getClientLimit() is synchronous with zero I/O.
 *
 * Unknown clients fall back to DEFAULT_LIMIT_PER_MINUTE (60).
 */

import prisma from "../lib/prisma";
import { cacheGet, cacheSet, cacheInvalidate } from "../lib/cache";
import { DEFAULT_LIMIT_PER_MINUTE } from "./defaults";

export { DEFAULT_LIMIT_PER_MINUTE } from "./defaults";

const MEMORY_CACHE_TTL_MS = 60_000;
const REDIS_CACHE_TTL = 120;

interface ClientEntry {
  limitPerMinute: number;
  displayName: string | null;
}

const memoryCache = new Map<string, ClientEntry>();
let lastRefreshAt = 0;

/** Reload in-memory cache from Postgres. */
export async function refreshClientCache(): Promise<void> {
  try {
    const rows = await prisma.clientConfig.findMany();
    memoryCache.clear();
    for (const row of rows) {
      memoryCache.set(row.id, {
        limitPerMinute: row.limitPerMinute,
        displayName: row.displayName,
      });
    }
    lastRefreshAt = Date.now();
  } catch (err) {
    const error = err as Error;
    console.error("[clientConfig] failed to refresh cache:", error.message);
  }
}

/**
 * Synchronous limit lookup from in-memory cache.
 * Triggers async background refresh if cache is stale.
 */
export function getClientLimit(clientId: string): number {
  if (Date.now() - lastRefreshAt > MEMORY_CACHE_TTL_MS) {
    refreshClientCache().catch(() => {});
  }
  const entry = memoryCache.get(clientId);
  return entry ? entry.limitPerMinute : DEFAULT_LIMIT_PER_MINUTE;
}

/** Synchronous display-name lookup from in-memory cache. */
export function getClientDisplayName(clientId: string): string | null {
  return memoryCache.get(clientId)?.displayName ?? null;
}

// ---------------------------------------------------------------------------
// Admin CRUD (async, uses Prisma + Redis cache)
// ---------------------------------------------------------------------------

export interface ClientConfigInput {
  id: string;
  limitPerMinute: number;
  displayName?: string;
}

export interface ClientConfigOutput {
  id: string;
  limitPerMinute: number;
  displayName: string | null;
  createdAt: string;
  updatedAt: string;
}

/** List all clients (Redis-cached 30s). */
export async function listClients(): Promise<ClientConfigOutput[]> {
  const cacheKey = "cache:client-configs:all";
  const cached = await cacheGet<ClientConfigOutput[]>(cacheKey);
  if (cached) return cached;

  const rows = await prisma.clientConfig.findMany({ orderBy: { id: "asc" } });
  const result = rows.map((r: { id: string; limitPerMinute: number; displayName: string | null; createdAt: Date; updatedAt: Date }) => ({
    id: r.id,
    limitPerMinute: r.limitPerMinute,
    displayName: r.displayName,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));

  await cacheSet(cacheKey, result, REDIS_CACHE_TTL);
  return result;
}

/** Get a single client by ID. */
export async function getClient(id: string): Promise<ClientConfigOutput | null> {
  const row = await prisma.clientConfig.findUnique({ where: { id } });
  if (!row) return null;
  return {
    id: row.id,
    limitPerMinute: row.limitPerMinute,
    displayName: row.displayName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Create or update a client config. */
export async function upsertClient(input: ClientConfigInput): Promise<ClientConfigOutput> {
  const row = await prisma.clientConfig.upsert({
    where: { id: input.id },
    update: {
      limitPerMinute: input.limitPerMinute,
      displayName: input.displayName ?? null,
    },
    create: {
      id: input.id,
      limitPerMinute: input.limitPerMinute,
      displayName: input.displayName ?? null,
    },
  });

  await Promise.all([
    cacheInvalidate("cache:client-configs:*"),
    refreshClientCache(),
  ]);

  return {
    id: row.id,
    limitPerMinute: row.limitPerMinute,
    displayName: row.displayName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Delete a client config. Returns false if not found. */
export async function deleteClient(id: string): Promise<boolean> {
  try {
    await prisma.clientConfig.delete({ where: { id } });
    await Promise.all([
      cacheInvalidate("cache:client-configs:*"),
      refreshClientCache(),
    ]);
    return true;
  } catch {
    return false;
  }
}
