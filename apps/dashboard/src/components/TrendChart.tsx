import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { TooltipProps } from "recharts";
import type { TrendPoint } from "../api";
import "./TrendChart.css";

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

interface CustomTooltipProps extends TooltipProps<number, string> {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; payload: TrendPoint }>;
  label?: string;
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || !payload.length || !label) return null;
  const point = payload[0].payload;
  return (
    <div className="trend-chart__tooltip">
      <div className="trend-chart__tooltip-date">{formatDateLabel(label)}</div>
      <div className="trend-chart__tooltip-row">
        <span>Total</span>
        <strong>{point.requestCount}</strong>
      </div>
      <div className="trend-chart__tooltip-row trend-chart__tooltip-row--allowed">
        <span>Allowed</span>
        <strong>{point.allowedCount}</strong>
      </div>
      <div className="trend-chart__tooltip-row trend-chart__tooltip-row--denied">
        <span>Denied</span>
        <strong>{point.deniedCount}</strong>
      </div>
      <div className="trend-chart__tooltip-row">
        <span>Avg response</span>
        <strong>{point.avgResponseTimeMs}ms</strong>
      </div>
    </div>
  );
}

function CustomLegend() {
  return (
    <div className="trend-chart__legend">
      <span className="trend-chart__legend-item">
        <span className="trend-chart__legend-dot trend-chart__legend-dot--allowed" />
        Allowed
      </span>
      <span className="trend-chart__legend-item">
        <span className="trend-chart__legend-dot trend-chart__legend-dot--denied" />
        Denied
      </span>
    </div>
  );
}

interface TrendChartProps {
  data: TrendPoint[];
}

export default function TrendChart({ data }: TrendChartProps) {
  return (
    <div className="trend-chart">
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id="trendFillAllowed" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2f9e6b" stopOpacity={0.28} />
              <stop offset="100%" stopColor="#2f9e6b" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="trendFillDenied" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#c4432b" stopOpacity={0.22} />
              <stop offset="100%" stopColor="#c4432b" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#e2e5ea" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={formatDateLabel}
            tick={{ fontSize: 11, fill: "#8b93a1", fontFamily: "IBM Plex Mono, monospace" }}
            axisLine={{ stroke: "#e2e5ea" }}
            tickLine={false}
            minTickGap={24}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "#8b93a1", fontFamily: "IBM Plex Mono, monospace" }}
            axisLine={false}
            tickLine={false}
            width={36}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend content={<CustomLegend />} />
          <Area
            type="monotone"
            dataKey="allowedCount"
            stackId="requests"
            stroke="#2f9e6b"
            strokeWidth={2}
            fill="url(#trendFillAllowed)"
            name="Allowed"
          />
          <Area
            type="monotone"
            dataKey="deniedCount"
            stackId="requests"
            stroke="#c4432b"
            strokeWidth={2}
            fill="url(#trendFillDenied)"
            name="Denied"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
