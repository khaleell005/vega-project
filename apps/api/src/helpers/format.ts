export function toDateString(value: Date | string): string {
  const str = value instanceof Date ? value.toISOString() : String(value);
  return str.split("T")[0];
}

export function toFixed(value: unknown, decimals: number = 2): number {
  return Number(parseFloat(String(value || 0)).toFixed(decimals));
}

export function serializeRequest(row: {
  id: bigint | string | number;
  status: string;
  responseTimeMs: number | { toNumber(): number };
  source: string;
  createdAt: Date | string;
}) {
  return {
    id: String(row.id),
    status: row.status,
    responseTimeMs: typeof row.responseTimeMs === "number"
      ? row.responseTimeMs
      : row.responseTimeMs.toNumber(),
    source: row.source,
    createdAt: row.createdAt instanceof Date
      ? row.createdAt.toISOString()
      : String(row.createdAt),
  };
}
