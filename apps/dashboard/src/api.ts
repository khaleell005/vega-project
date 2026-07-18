const API_BASE: string = import.meta.env.VITE_API_BASE || "http://localhost:3000";

export interface UsageResponse {
  clientId: string;
  count: number;
  limit: number;
  windowSecondsRemaining: number;
}

export interface TrendPoint {
  date: string;
  requestCount: number;
  allowedCount: number;
  deniedCount: number;
  avgResponseTimeMs: number;
}

export interface AnalyticsResponse {
  clientId: string;
  range: string;
  totalRequests: number;
  allowedRequests: number;
  deniedRequests: number;
  avgResponseTimeMs: number;
  trend: TrendPoint[];
}

export async function fetchUsage(clientId: string): Promise<UsageResponse> {
  const res = await fetch(`${API_BASE}/usage/${encodeURIComponent(clientId)}`);
  if (!res.ok) throw new Error(`usage fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchAnalytics(
  clientId: string,
  range: string
): Promise<AnalyticsResponse> {
  const res = await fetch(
    `${API_BASE}/analytics/${encodeURIComponent(clientId)}?range=${range}`
  );
  if (!res.ok) throw new Error(`analytics fetch failed: ${res.status}`);
  return res.json();
}

export interface RequestEntry {
  id: string;
  status: string;
  responseTimeMs: number;
  source: string;
  createdAt: string;
}

export interface RequestFilters {
  status?: "allowed" | "denied";
  source?: "redis" | "local-fallback";
  maxLatency?: number;
}

export async function fetchRequests(
  clientId: string,
  limit: number = 50,
  filters?: RequestFilters
): Promise<RequestEntry[]> {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  if (filters?.status) params.set("status", filters.status);
  if (filters?.source) params.set("source", filters.source);
  if (filters?.maxLatency !== undefined) params.set("maxLatency", String(filters.maxLatency));

  const res = await fetch(
    `${API_BASE}/requests/${encodeURIComponent(clientId)}?${params.toString()}`
  );
  if (!res.ok) throw new Error(`requests fetch failed: ${res.status}`);
  return res.json();
}
