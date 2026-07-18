import { useState, useEffect, useCallback } from "react";
import QuotaGauge from "./components/QuotaGauge";
import StatCard from "./components/StatCard";
import RangeFilter from "./components/RangeFilter";
import TrendChart from "./components/TrendChart";
import RequestLog from "./components/RequestLog";
import {
  fetchUsage,
  fetchAnalytics,
  fetchRequests,
  UsageResponse,
  AnalyticsResponse,
  RequestEntry,
  RequestFilters,
} from "./api";
import "./App.css";

const CLIENTS = [
  { value: "client-a", label: "Client A" },
  { value: "client-b", label: "Client B" },
];

const POLL_MS = 4000;

export default function App() {
  const [clientId, setClientId] = useState<string>(CLIENTS[0].value);
  const [range, setRange] = useState<string>("10d");

  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);

  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState<boolean>(true);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);

  const [requests, setRequests] = useState<RequestEntry[]>([]);
  const [requestsError, setRequestsError] = useState<string | null>(null);
  const [requestFilters, setRequestFilters] = useState<RequestFilters>({});

  const loadUsage = useCallback(async () => {
    try {
      const data = await fetchUsage(clientId);
      setUsage(data);
      setUsageError(null);
    } catch (err) {
      setUsageError((err as Error).message);
    }
  }, [clientId]);

  const loadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    setAnalyticsError(null);
    try {
      const data = await fetchAnalytics(clientId, range);
      setAnalytics(data);
    } catch (err) {
      setAnalyticsError((err as Error).message);
    } finally {
      setAnalyticsLoading(false);
    }
  }, [clientId, range]);

  const loadRequests = useCallback(async () => {
    try {
      const data = await fetchRequests(clientId, 50, requestFilters);
      setRequests(data);
      setRequestsError(null);
    } catch (err) {
      setRequestsError((err as Error).message);
    }
  }, [clientId, requestFilters]);

  useEffect(() => {
    loadUsage();
    const interval = setInterval(loadUsage, POLL_MS);
    return () => clearInterval(interval);
  }, [loadUsage]);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  useEffect(() => {
    loadRequests();
    const interval = setInterval(loadRequests, POLL_MS);
    return () => clearInterval(interval);
  }, [loadRequests]);

  return (
    <div className="app">
      <header className="app__header">
        <div>
          <span className="app__eyebrow">Global Rate Limiter</span>
          <h1 className="app__title">Quota</h1>
        </div>

        <label className="app__client-select">
          <span className="app__client-select-label">Client</span>
          <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
            {CLIENTS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      </header>

      <main className="app__main">
        <section className="app__gauge-section">
          {usage ? (
            <QuotaGauge
              count={usage.count}
              limit={usage.limit}
              windowSecondsRemaining={usage.windowSecondsRemaining}
            />
          ) : usageError ? (
            <div className="app__error">Couldn't load live usage: {usageError}</div>
          ) : (
            <div className="app__loading">Loading live usage…</div>
          )}
        </section>

        <section className="app__stats">
          {analytics && (
            <>
              <StatCard label="Total requests" value={analytics.totalRequests.toLocaleString()} />
              <StatCard
                label="Allowed"
                value={analytics.allowedRequests.toLocaleString()}
                tone="safe"
              />
              <StatCard
                label="Denied"
                value={analytics.deniedRequests.toLocaleString()}
                tone={analytics.deniedRequests > 0 ? "danger" : "neutral"}
              />
              <StatCard label="Avg response" value={`${analytics.avgResponseTimeMs}ms`} />
            </>
          )}
        </section>

        <section className="app__trend-section">
          <div className="app__trend-header">
            <h2 className="app__trend-title">Request trend</h2>
            <RangeFilter value={range} onChange={setRange} />
          </div>

          {analyticsLoading ? (
            <div className="app__loading">Loading trend…</div>
          ) : analyticsError ? (
            <div className="app__error">Couldn't load trend: {analyticsError}</div>
          ) : analytics ? (
            <TrendChart data={analytics.trend} />
          ) : null}
        </section>

        <section className="app__log-section">
          <div className="app__trend-header">
            <h2 className="app__trend-title">Recent requests</h2>
            <button className="app__refresh-btn" onClick={loadRequests}>
              Refresh
            </button>
          </div>
          <RequestLog
            requests={requests}
            loading={requests.length === 0}
            error={requestsError}
            filters={requestFilters}
            onFiltersChange={setRequestFilters}
          />
        </section>
      </main>
    </div>
  );
}
