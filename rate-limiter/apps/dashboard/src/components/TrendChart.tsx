import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
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
  payload?: Array<{ payload: TrendPoint }>;
  label?: string;
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || !payload.length || !label) return null;
  const point = payload[0].payload;
  return (
    <div className="trend-chart__tooltip">
      <div className="trend-chart__tooltip-date">{formatDateLabel(label)}</div>
      <div className="trend-chart__tooltip-row">
        <span>Requests</span>
        <strong>{point.requestCount}</strong>
      </div>
      <div className="trend-chart__tooltip-row">
        <span>Avg response</span>
        <strong>{point.avgResponseTimeMs}ms</strong>
      </div>
    </div>
  );
}

interface TrendChartProps {
  data: TrendPoint[];
}

export default function TrendChart({ data }: TrendChartProps) {
  return (
    <div className="trend-chart">
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3a4f91" stopOpacity={0.28} />
              <stop offset="100%" stopColor="#3a4f91" stopOpacity={0.02} />
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
          <Area
            type="monotone"
            dataKey="requestCount"
            stroke="#3a4f91"
            strokeWidth={2}
            fill="url(#trendFill)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
