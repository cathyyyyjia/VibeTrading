// ============================================================
// EquityChart - Equity curve line chart using Recharts
// Design: Swiss Precision - minimal, clean area chart
// Dark mode compatible
// ============================================================

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useTheme } from '@/contexts/ThemeContext';

interface EquityChartProps {
  data: Array<{ t?: number; v?: number; timestamp?: string; value?: number }> | null;
  loading: boolean;
}

function formatValue(value: number): string {
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(1)}k`;
  }
  return `$${value}`;
}

function CustomTooltip({ active, payload, label }: any) {
  if (active && payload && payload.length) {
    const date = new Date(label);
    return (
      <div className="bg-foreground text-primary-foreground px-3 py-2 rounded-md shadow-lg text-xs font-mono">
        <div className="text-[10px] text-primary-foreground/70 mb-0.5">
          {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </div>
        <div className="font-medium">${payload[0].value.toLocaleString()}</div>
      </div>
    );
  }
  return null;
}

function SkeletonChart() {
  return (
    <div className="border border-border rounded-lg p-4 bg-card">
      <div className="h-[220px] bg-muted/30 rounded animate-pulse" />
    </div>
  );
}

export default function EquityChart({ data, loading }: EquityChartProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  if (loading) return <SkeletonChart />;
  if (!data || data.length === 0) return null;

  // Normalize data: support both {t, v} and {timestamp, value} formats
  const normalizedData = data.map((d) => ({
    t: d.t ?? (d.timestamp ? new Date(d.timestamp).getTime() : 0),
    v: d.v ?? d.value ?? 0,
  }));

  const values = normalizedData.map((d) => d.v);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const padding = (maxVal - minVal) * 0.05;

  // Theme-aware colors
  const lineColor = isDark ? '#e4e4e7' : '#18181B';
  const gridColor = isDark ? '#27272a' : '#f0f0f0';
  const tickColor = isDark ? '#71717a' : '#94a3b8';
  const cursorColor = isDark ? '#3f3f46' : '#e2e8f0';
  const gradientOpacityStart = isDark ? 0.12 : 0.06;
  const gradientOpacityEnd = isDark ? 0.02 : 0.01;

  return (
    <div className="border border-border rounded-lg p-4 bg-card">
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={normalizedData} margin={{ top: 8, right: 8, left: -5, bottom: 0 }}>
          <defs>
            <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={lineColor} stopOpacity={gradientOpacityStart} />
              <stop offset="95%" stopColor={lineColor} stopOpacity={gradientOpacityEnd} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
          <XAxis
            dataKey="t"
            tick={{ fontSize: 10, fill: tickColor }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(val) => {
              const d = new Date(val);
              return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            }}
            interval={Math.floor(data.length / 6)}
          />
          <YAxis
            tick={{ fontSize: 10, fill: tickColor }}
            tickLine={false}
            axisLine={false}
            tickFormatter={formatValue}
            width={52}
            domain={[Math.floor(minVal - padding), Math.ceil(maxVal + padding)]}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ stroke: cursorColor, strokeWidth: 1 }} />
          <Area
            type="monotone"
            dataKey="v"
            stroke={lineColor}
            strokeWidth={1.5}
            fill="url(#equityGradient)"
            dot={false}
            activeDot={{ r: 3, fill: lineColor, strokeWidth: 0 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
