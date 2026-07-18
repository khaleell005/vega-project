import { useState } from "react";
import { RequestEntry, RequestFilters } from "../api";
import "./RequestLog.css";

interface RequestLogProps {
  requests: RequestEntry[];
  loading: boolean;
  error: string | null;
  filters: RequestFilters;
  onFiltersChange: (filters: RequestFilters) => void;
}

export default function RequestLog({
  requests,
  loading,
  error,
  filters,
  onFiltersChange,
}: RequestLogProps) {
  const [localStatus, setLocalStatus] = useState<string>(filters.status || "");
  const [localSource, setLocalSource] = useState<string>(filters.source || "");
  const [localLatency, setLocalLatency] = useState<string>(
    filters.maxLatency !== undefined ? String(filters.maxLatency) : ""
  );

  function applyFilters() {
    const f: RequestFilters = {};
    if (localStatus === "allowed" || localStatus === "denied") f.status = localStatus;
    if (localSource === "redis" || localSource === "local-fallback") f.source = localSource;
    if (localLatency !== "" && !isNaN(parseFloat(localLatency))) f.maxLatency = parseFloat(localLatency);
    onFiltersChange(f);
  }

  function clearFilters() {
    setLocalStatus("");
    setLocalSource("");
    setLocalLatency("");
    onFiltersChange({});
  }

  const hasActiveFilters = filters.status || filters.source || filters.maxLatency !== undefined;

  return (
    <div className="request-log">
      <div className="request-log__filters">
        <label className="request-log__filter-label">
          Status
          <select value={localStatus} onChange={(e) => setLocalStatus(e.target.value)}>
            <option value="">All</option>
            <option value="allowed">Allowed</option>
            <option value="denied">Denied</option>
          </select>
        </label>
        <label className="request-log__filter-label">
          Source
          <select value={localSource} onChange={(e) => setLocalSource(e.target.value)}>
            <option value="">All</option>
            <option value="redis">Redis</option>
            <option value="local-fallback">Fallback</option>
          </select>
        </label>
        <label className="request-log__filter-label">
          Max latency
          <input
            type="number"
            placeholder="ms"
            min={0}
            step={1}
            value={localLatency}
            onChange={(e) => setLocalLatency(e.target.value)}
          />
        </label>
        <div className="request-log__filter-actions">
          <button className="request-log__filter-btn request-log__filter-btn--apply" onClick={applyFilters}>
            Filter
          </button>
          {hasActiveFilters && (
            <button className="request-log__filter-btn request-log__filter-btn--clear" onClick={clearFilters}>
              Clear
            </button>
          )}
        </div>
      </div>

      {loading && requests.length === 0 ? (
        <div className="request-log__empty">Loading requests...</div>
      ) : error ? (
        <div className="request-log__empty request-log__empty--error">{error}</div>
      ) : requests.length === 0 ? (
        <div className="request-log__empty">
          {hasActiveFilters ? "No requests match the current filters" : "No requests yet"}
        </div>
      ) : (
        <div className="request-log__scroll">
          <table className="request-log__table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Status</th>
                <th>Latency</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td className="request-log__time">{new Date(r.createdAt).toLocaleTimeString()}</td>
                  <td>
                    <span className={`request-log__badge request-log__badge--${r.status}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="request-log__mono">{r.responseTimeMs.toFixed(1)}ms</td>
                  <td className="request-log__mono request-log__muted">{r.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
