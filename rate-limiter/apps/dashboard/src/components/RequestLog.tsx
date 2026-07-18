import { RequestEntry } from "../api";
import "./RequestLog.css";

interface RequestLogProps {
  requests: RequestEntry[];
  loading: boolean;
  error: string | null;
}

export default function RequestLog({ requests, loading, error }: RequestLogProps) {
  return (
    <div className="request-log">
      {loading && requests.length === 0 ? (
        <div className="request-log__empty">Loading requests...</div>
      ) : error ? (
        <div className="request-log__empty request-log__empty--error">{error}</div>
      ) : requests.length === 0 ? (
        <div className="request-log__empty">No requests yet</div>
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
                  <td className="request-log__time">
                    {new Date(r.createdAt).toLocaleTimeString()}
                  </td>
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
