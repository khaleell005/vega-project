import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { cacheGet, cacheSet, cacheInvalidate } from "../lib/cache";
import { DEFAULT_LIMIT_PER_MINUTE } from "./defaults";
import { cacheOrFetch } from "../helpers/cache";

export { DEFAULT_LIMIT_PER_MINUTE } from "./defaults";

const MEMORY_CACHE_TTL_MS = 60_000;
const REDIS_CACHE_TTL = 120;

interface ClientEntry {
  limitPerMinute: number;
  displayName: string | null;
}

const memoryCache = new Map<string, ClientEntry>();
let lastRefreshAt = 0;

async function loadAllFromDb(): Promise<void> {
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
    console.error("[clientConfig] failed to refresh cache:", (err as Error).message);
  }
}

export async function refreshClientCache(): Promise<void> {
  return loadAllFromDb();
}

export function getClientLimit(clientId: string): number {
  if (Date.now() - lastRefreshAt > MEMORY_CACHE_TTL_MS) {
    loadAllFromDb().catch(() => {});
  }
  return memoryCache.get(clientId)?.limitPerMinute ?? DEFAULT_LIMIT_PER_MINUTE;
}

export function getClientDisplayName(clientId: string): string | null {
  return memoryCache.get(clientId)?.displayName ?? null;
}

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

function serializeClient(row: {
  id: string;
  limitPerMinute: number;
  displayName: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ClientConfigOutput {
  return {
    id: row.id,
    limitPerMinute: row.limitPerMinute,
    displayName: row.displayName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listClients(): Promise<ClientConfigOutput[]> {
  return cacheOrFetch("cache:client-configs:all", REDIS_CACHE_TTL, async () => {
    const rows = await prisma.clientConfig.findMany({ orderBy: { id: "asc" } });
    return rows.map(serializeClient);
  });
}

export async function getClient(id: string): Promise<ClientConfigOutput | null> {
  const row = await prisma.clientConfig.findUnique({ where: { id } });
  if (!row) return null;
  return serializeClient(row);
}

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
    loadAllFromDb(),
  ]);

  return serializeClient(row);
}

export async function deleteClient(id: string): Promise<boolean> {
  try {
    await prisma.clientConfig.delete({ where: { id } });
    await Promise.all([
      cacheInvalidate("cache:client-configs:*"),
      loadAllFromDb(),
    ]);
    return true;
  } catch {
    return false;
  }
}
