import {
  Bar,
  ComposedChart,
  ErrorBar,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { useMemo } from "react";
import { useI18n } from "@/contexts/I18nContext";
import { useTheme } from "@/contexts/ThemeContext";
import { formatDateByLocale } from "@/lib/date";
import type { TradeRecord } from "@/lib/api";

interface EquityChartProps {
  data: Array<{ t?: number; v?: number; timestamp?: string; value?: number }> | null;
  market?: Array<{ t: string; o: number; h: number; l: number; c: number }> | null;
  trades?: TradeRecord[] | null;
  loading: boolean;
}

type ChartRow = {
  t: string;
  marketOpen: number;
  marketHigh: number;
  marketLow: number;
  marketClose: number;
  wickRange: [number, number];
  bodyMid: number;
  bodySize: number;
  equity: number;
  tradeCount: number;
  tradeDetails: Array<{ action: string; qty: number; price: number }>;
};

const COLOR_PRESET = {
  up: "#22c55e",
  down: "#ef4444",
  curve: "#6366f1",
  trade: "#8b5cf6",
};

function formatMoney(value: number): string {
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function CandleBody(props: any) {
  const { x, y, width, height, payload } = props;
  const isUp = payload.marketClose >= payload.marketOpen;
  const fill = isUp ? COLOR_PRESET.up : COLOR_PRESET.down;
  const bodyWidth = Math.max(2, Math.min(10, width * 0.55));
  const bodyX = x + (width - bodyWidth) / 2;
  const bodyHeight = Math.max(1.5, height);
  return <rect x={bodyX} y={y} width={bodyWidth} height={bodyHeight} rx={1} fill={fill} opacity={0.9} />;
}

function SkeletonChart() {
  return (
    <div className="border border-border rounded-lg p-4 bg-card">
      <div className="h-[260px] bg-muted/30 rounded animate-pulse" />
    </div>
  );
}

function CustomTooltip({ active, payload, label, locale, t }: any) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload as ChartRow | undefined;
  if (!row) return null;
  const dateLabel = formatDateByLocale(label, locale);
  return (
    <div className="bg-foreground text-primary-foreground px-3 py-2 rounded-md shadow-lg text-xs">
      <div className="text-[10px] text-primary-foreground/75 mb-1">{dateLabel}</div>
      <div>{t("chart.marketOhlc")}: {row.marketOpen.toFixed(2)} / {row.marketHigh.toFixed(2)} / {row.marketLow.toFixed(2)} / {row.marketClose.toFixed(2)}</div>
      <div>{t("chart.strategyCurve")}: {formatMoney(row.equity)}</div>
      {row.tradeCount > 0 && (
        <div className="mt-1 border-t border-primary-foreground/20 pt-1">
          <div>{t("chart.tradeMarker")} × {row.tradeCount}</div>
          {row.tradeDetails.slice(0, 2).map((item, idx) => (
            <div key={idx} className="text-[10px] text-primary-foreground/80">
              {item.action} {item.qty}@{item.price.toFixed(2)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function EquityChart({ data, market, trades, loading }: EquityChartProps) {
  const { locale, t } = useI18n();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const chartData = useMemo<ChartRow[]>(() => {
    if (!data || data.length === 0 || !market || market.length === 0) return [];

    const equityByDay = new Map<string, number>();
    for (const point of data) {
      const raw = point.timestamp ?? (typeof point.t === "number" ? new Date(point.t).toISOString() : "");
      const day = raw.slice(0, 10);
      const val = Number(point.value ?? point.v ?? 0);
      if (day) equityByDay.set(day, val);
    }

    const tradesByDay = new Map<string, Array<{ action: string; qty: number; price: number }>>();
    for (const trade of trades || []) {
      const day = (trade.timestamp || trade.entryTime || "").slice(0, 10);
      if (!day) continue;
      const next = tradesByDay.get(day) ?? [];
      next.push({
        action: trade.action,
        qty: 1,
        price: Number(trade.price || 0),
      });
      tradesByDay.set(day, next);
    }

    return market
      .filter((c) => c && typeof c.t === "string")
      .map((c) => {
        const day = c.t.slice(0, 10);
        const o = Number(c.o);
        const h = Number(c.h);
        const l = Number(c.l);
        const close = Number(c.c);
        const details = tradesByDay.get(day) ?? [];
        return {
          t: day,
          marketOpen: o,
          marketHigh: h,
          marketLow: l,
          marketClose: close,
          wickRange: [l, h] as [number, number],
          bodyMid: (o + close) / 2,
          bodySize: Math.abs(close - o),
          equity: Number(equityByDay.get(day) ?? 0),
          tradeCount: details.length,
          tradeDetails: details,
        };
      })
      .filter((row) => Number.isFinite(row.equity));
  }, [data, market, trades]);

  if (loading) return <SkeletonChart />;
  if (chartData.length === 0) return null;

  const gridColor = isDark ? "#27272a" : "#eceff3";
  const axisColor = isDark ? "#a1a1aa" : "#64748b";
  const cursorColor = isDark ? "#3f3f46" : "#d9dde4";

  const tradeMarkers = chartData
    .filter((d) => d.tradeCount > 0)
    .map((d) => ({ t: d.t, y: d.equity, tradeCount: d.tradeCount }));

  return (
    <div className="border border-border rounded-lg p-4 bg-card">
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
          <XAxis
            dataKey="t"
            tick={{ fontSize: 10, fill: axisColor }}
            tickLine={false}
            axisLine={false}
            minTickGap={26}
            tickFormatter={(val) => formatDateByLocale(String(val), locale)}
          />
          <YAxis
            yAxisId="market"
            orientation="left"
            tick={{ fontSize: 10, fill: axisColor }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => String(Number(v).toFixed(2))}
            width={52}
          />
          <YAxis
            yAxisId="equity"
            orientation="right"
            tick={{ fontSize: 10, fill: axisColor }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => formatMoney(Number(v))}
            width={74}
          />
          <Tooltip content={<CustomTooltip locale={locale} t={t} />} cursor={{ stroke: cursorColor, strokeWidth: 1 }} />

          <Bar yAxisId="market" dataKey="bodyMid" shape={<CandleBody />} barSize={10}>
            <ErrorBar dataKey="wickRange" width={0} strokeWidth={1} stroke={isDark ? "#a1a1aa" : "#334155"} />
          </Bar>

          <Line
            yAxisId="equity"
            type="monotone"
            dataKey="equity"
            stroke={COLOR_PRESET.curve}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3.5, fill: COLOR_PRESET.curve, strokeWidth: 0 }}
            name={t("chart.strategyCurve")}
          />

          <Scatter
            yAxisId="equity"
            data={tradeMarkers}
            dataKey="y"
            fill={COLOR_PRESET.trade}
            name={t("chart.tradeMarker")}
            shape="circle"
          />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLOR_PRESET.up }} />
          {t("chart.marketUp")}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLOR_PRESET.down }} />
          {t("chart.marketDown")}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-2.5 h-[2px] rounded-full" style={{ backgroundColor: COLOR_PRESET.curve }} />
          {t("chart.strategyCurve")}
        </span>
      </div>
    </div>
  );
}
