import "./QuotaGauge.css";

interface QuotaGaugeProps {
  count: number;
  limit: number;
  windowSecondsRemaining: number;
}

type StatusKey = "danger" | "warn" | "safe";

interface Status {
  key: StatusKey;
  label: string;
}

function getStatus(fraction: number): Status {
  if (fraction >= 0.9) return { key: "danger", label: "Near limit" };
  if (fraction >= 0.7) return { key: "warn", label: "Elevated" };
  return { key: "safe", label: "Healthy" };
}

export default function QuotaGauge({ count, limit, windowSecondsRemaining }: QuotaGaugeProps) {
  const fraction = limit > 0 ? Math.min(count / limit, 1) : 0;
  const status = getStatus(fraction);
  const ticks = Array.from({ length: 11 }, (_, i) => i * 10);

  return (
    <div className="quota-gauge">
      <div className="quota-gauge__header">
        <span className="quota-gauge__eyebrow">Current window</span>
        <span className={`quota-gauge__status quota-gauge__status--${status.key}`}>
          {status.label}
        </span>
      </div>

      <div className="quota-gauge__track">
        <div
          className={`quota-gauge__fill quota-gauge__fill--${status.key}`}
          style={{ width: `${fraction * 100}%` }}
        />
        <div className="quota-gauge__ticks">
          {ticks.map((t) => (
            <span key={t} className="quota-gauge__tick" style={{ left: `${t}%` }} />
          ))}
        </div>
      </div>

      <div className="quota-gauge__readout">
        <span className="quota-gauge__count">
          {count.toLocaleString()}
          <span className="quota-gauge__slash">/</span>
          {limit.toLocaleString()}
        </span>
        <span className="quota-gauge__label">requests this minute</span>
      </div>

      <div className="quota-gauge__reset">
        Window resets in <strong>{windowSecondsRemaining}s</strong>
      </div>
    </div>
  );
}
