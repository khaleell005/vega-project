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

export async function fetchRequests(
  clientId: string,
  limit: number = 50
): Promise<RequestEntry[]> {
  const res = await fetch(
    `${API_BASE}/requests/${encodeURIComponent(clientId)}?limit=${limit}`
  );
  if (!res.ok) throw new Error(`requests fetch failed: ${res.status}`);
  return res.json();
}
