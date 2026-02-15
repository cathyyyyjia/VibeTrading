import {
  Area,
  AreaChart,
  Brush,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/contexts/I18nContext";
import { useTheme } from "@/contexts/ThemeContext";
import { useChartColor } from "@/contexts/ChartColorContext";
import { formatDateByLocale } from "@/lib/date";
import type { TradeRecord } from "@/lib/api";

interface EquityChartProps {
  data: Array<{ t?: number; v?: number; timestamp?: string; value?: number }> | null;
  market?: Array<{ t: string; o: number; h: number; l: number; c: number }> | null;
  trades?: TradeRecord[] | null;
  loading: boolean;
}

type TradePoint = {
  action: string;
  price: number;
};

type ChartRow = {
  ts: number;
  day: string;
  equity: number;
  returnPct: number;
  drawdownPct: number;
  buyCount: number;
  sellCount: number;
  trades: TradePoint[];
  inPosition: boolean;
};

type PositionBand = {
  x1: number;
  x2: number;
  positive: boolean;
};

type WindowPreset = "3m" | "6m" | "1y" | "all";

const COLOR_PRESET = {
  curve: "#4f46e5",
  drawdown: "rgba(99, 102, 241, 0.18)",
};

function formatMoney(value: number): string {
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function formatPct(value: number): string {
  return `${value.toFixed(2)}%`;
}

function toDay(raw: string): string {
  return raw.slice(0, 10);
}

function toTs(day: string): number {
  return new Date(`${day}T00:00:00Z`).getTime();
}

function downsampleRows(rows: ChartRow[], maxPoints: number): ChartRow[] {
  if (rows.length <= maxPoints) return rows;
  const keep = new Set<number>([0, rows.length - 1]);
  const step = Math.ceil(rows.length / maxPoints);

  for (let i = 0; i < rows.length; i += step) keep.add(i);
  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i].buyCount > 0 || rows[i].sellCount > 0) keep.add(i);
  }

  return Array.from(keep)
    .sort((a, b) => a - b)
    .map((idx) => rows[idx]);
}

function buildPositionBands(rows: ChartRow[]): PositionBand[] {
  const bands: PositionBand[] = [];
  let startIdx: number | null = null;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.inPosition && startIdx === null) startIdx = i;
    const isLast = i === rows.length - 1;
    const closesBand = !row.inPosition || isLast;

    if (startIdx !== null && closesBand) {
      const endIdx = row.inPosition && isLast ? i : Math.max(startIdx, i - 1);
      const start = rows[startIdx];
      const end = rows[endIdx];
      bands.push({
        x1: start.ts,
        x2: end.ts,
        positive: end.returnPct >= start.returnPct,
      });
      startIdx = null;
    }
  }

  return bands;
}

function SkeletonChart() {
  return (
    <div className="border border-border rounded-lg p-4 bg-card">
      <div className="h-[330px] bg-muted/30 rounded animate-pulse" />
    </div>
  );
}

function BuyDot(props: any) {
  const { cx, cy, payload, fill } = props;
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || !payload?.buyCount) return null;
  return <circle cx={cx} cy={cy} r={3.5} fill={fill} stroke="white" strokeWidth={1} />;
}

function SellDot(props: any) {
  const { cx, cy, payload, fill } = props;
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || !payload?.sellCount) return null;
  return <circle cx={cx} cy={cy} r={3.5} fill={fill} stroke="white" strokeWidth={1} />;
}

function CustomTooltip({ active, payload, label, locale }: any) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload as ChartRow | undefined;
  if (!row) return null;

  const dateLabel = formatDateByLocale(new Date(label).toISOString().slice(0, 10), locale);
  const buys = row.buyCount;
  const sells = row.sellCount;

  return (
    <div className="bg-foreground text-primary-foreground px-3 py-2 rounded-md shadow-lg text-xs">
      <div className="text-[10px] text-primary-foreground/75 mb-1">{dateLabel}</div>
      <div>{locale === "zh" ? "策略净值" : "Equity"}: {formatMoney(row.equity)}</div>
      <div>{locale === "zh" ? "累计收益" : "Return"}: {formatPct(row.returnPct)}</div>
      <div>{locale === "zh" ? "回撤" : "Drawdown"}: {formatPct(row.drawdownPct)}</div>
      {(buys > 0 || sells > 0) && (
        <div className="mt-1 border-t border-primary-foreground/20 pt-1">
          <div>{locale === "zh" ? "信号" : "Signals"}: {buys > 0 ? `${locale === "zh" ? "买入" : "Buy"} × ${buys}` : ""}{buys > 0 && sells > 0 ? " | " : ""}{sells > 0 ? `${locale === "zh" ? "卖出" : "Sell"} × ${sells}` : ""}</div>
        </div>
      )}
    </div>
  );
}

export default function EquityChart({ data, trades, loading }: EquityChartProps) {
  const { locale, t } = useI18n();
  const { theme } = useTheme();
  const { palette } = useChartColor();
  const isDark = theme === "dark";
  const [windowPreset, setWindowPreset] = useState<WindowPreset>("6m");
  const [brushRange, setBrushRange] = useState<{ start: number; end: number }>({ start: 0, end: 0 });

  const rows = useMemo<ChartRow[]>(() => {
    if (!data || data.length === 0) return [];

    const equityByDay = new Map<string, number>();
    for (const point of data) {
      const raw =
        point.timestamp ??
        (typeof point.t === "number" ? new Date(point.t).toISOString() : "");
      const day = toDay(raw);
      const val = Number(point.value ?? point.v ?? 0);
      if (day && Number.isFinite(val)) equityByDay.set(day, val);
    }

    const tradesByDay = new Map<string, TradePoint[]>();
    for (const trade of trades || []) {
      const day = toDay(trade.timestamp || trade.entryTime || "");
      if (!day) continue;
      const next = tradesByDay.get(day) ?? [];
      next.push({ action: String(trade.action || "").toUpperCase(), price: Number(trade.price || 0) });
      tradesByDay.set(day, next);
    }

    const sortedDays = Array.from(equityByDay.keys()).sort();
    if (sortedDays.length === 0) return [];

    const base = Number(equityByDay.get(sortedDays[0]) ?? 0);
    if (!Number.isFinite(base) || base === 0) return [];

    let peak = base;
    let position = 0;
    const built: ChartRow[] = [];

    for (const day of sortedDays) {
      const equity = Number(equityByDay.get(day) ?? 0);
      const dayTrades = tradesByDay.get(day) ?? [];
      let buyCount = 0;
      let sellCount = 0;

      for (const item of dayTrades) {
        if (item.action.includes("BUY")) {
          buyCount += 1;
          position += 1;
        } else if (item.action.includes("SELL")) {
          sellCount += 1;
          position = Math.max(0, position - 1);
        }
      }

      peak = Math.max(peak, equity);
      const returnPct = ((equity / base) - 1) * 100;
      const drawdownPct = peak > 0 ? ((equity - peak) / peak) * 100 : 0;

      built.push({
        ts: toTs(day),
        day,
        equity,
        returnPct,
        drawdownPct,
        buyCount,
        sellCount,
        trades: dayTrades,
        inPosition: position > 0,
      });
    }

    return downsampleRows(built, 900);
  }, [data, trades]);

  const positionBands = useMemo(() => buildPositionBands(rows), [rows]);
  const presetPoints: Record<WindowPreset, number> = {
    "3m": 63,
    "6m": 126,
    "1y": 252,
    all: Number.POSITIVE_INFINITY,
  };

  useEffect(() => {
    if (rows.length === 0) {
      setBrushRange({ start: 0, end: 0 });
      return;
    }
    const last = rows.length - 1;
    const points = presetPoints[windowPreset];
    if (!Number.isFinite(points) || rows.length <= points) {
      setBrushRange({ start: 0, end: last });
      return;
    }
    const start = Math.max(0, rows.length - points);
    setBrushRange({ start, end: last });
  }, [rows.length, windowPreset]);

  if (loading) return <SkeletonChart />;
  if (rows.length === 0) return null;

  const tradeBuys = rows.filter((d) => d.buyCount > 0).map((d) => ({ ...d, markerY: d.returnPct }));
  const tradeSells = rows.filter((d) => d.sellCount > 0).map((d) => ({ ...d, markerY: d.returnPct }));

  const returnValues = rows.map((d) => d.returnPct);
  const drawdownValues = rows.map((d) => d.drawdownPct);
  const minReturn = Math.min(...returnValues);
  const maxReturn = Math.max(...returnValues);
  const minDrawdown = Math.min(...drawdownValues);

  const gridColor = isDark ? "#27272a" : "#eceff3";
  const axisColor = isDark ? "#a1a1aa" : "#64748b";
  const cursorColor = isDark ? "#3f3f46" : "#d9dde4";
  const presetButtons: Array<{ key: WindowPreset; label: string }> = [
    { key: "3m", label: t("strategy.backtestPreset3m") },
    { key: "6m", label: t("strategy.backtestPreset6m") },
    { key: "1y", label: t("strategy.backtestPreset1y") },
    { key: "all", label: t("strategy.backtestPresetAll") },
  ];

  return (
    <div className="border border-border rounded-lg p-4 bg-card space-y-3">
      <div className="flex items-center justify-end gap-1.5">
        {presetButtons.map((preset) => {
          const active = windowPreset === preset.key;
          return (
            <button
              key={preset.key}
              type="button"
              onClick={() => setWindowPreset(preset.key)}
              className={`h-7 px-2.5 text-[11px] rounded-md border transition-colors ${
                active
                  ? "bg-foreground text-background border-foreground"
                  : "bg-background text-muted-foreground border-border hover:text-foreground"
              }`}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
      <div className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} syncId="bt-chart" margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
            {positionBands.map((band, idx) => (
              <ReferenceArea
                key={`${band.x1}-${band.x2}-${idx}`}
                x1={band.x1}
                x2={band.x2}
                y1={minReturn - 1}
                y2={maxReturn + 1}
                fill={band.positive ? palette.holdUp : palette.holdDown}
                strokeOpacity={0}
              />
            ))}
            <XAxis
              dataKey="ts"
              type="number"
              domain={["dataMin", "dataMax"]}
              tick={{ fontSize: 10, fill: axisColor }}
              tickLine={false}
              axisLine={false}
              minTickGap={26}
              tickFormatter={(val) => formatDateByLocale(new Date(Number(val)).toISOString().slice(0, 10), locale)}
            />
            <YAxis
              yAxisId="return"
              tick={{ fontSize: 10, fill: axisColor }}
              tickLine={false}
              axisLine={false}
              width={56}
              tickFormatter={(v) => `${Number(v).toFixed(1)}%`}
            />
            <Tooltip content={<CustomTooltip locale={locale} />} cursor={{ stroke: cursorColor, strokeWidth: 1 }} />
            <Legend />

            <Line
              yAxisId="return"
              type="monotone"
              dataKey="returnPct"
              stroke={COLOR_PRESET.curve}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3.5, fill: COLOR_PRESET.curve, strokeWidth: 0 }}
              name={locale === "zh" ? "策略累计收益" : "Strategy Return"}
            />

            <Scatter
              yAxisId="return"
              data={tradeBuys}
              dataKey="markerY"
              fill={palette.up}
              shape={<BuyDot />}
              name={locale === "zh" ? "买点" : "Buy"}
              legendType="circle"
            />

            <Scatter
              yAxisId="return"
              data={tradeSells}
              dataKey="markerY"
              fill={palette.down}
              shape={<SellDot />}
              name={locale === "zh" ? "卖点" : "Sell"}
              legendType="circle"
            />

            {rows.length > 120 && (
              <Brush
                dataKey="ts"
                height={22}
                stroke={isDark ? "#71717a" : "#94a3b8"}
                travellerWidth={8}
                startIndex={brushRange.start}
                endIndex={brushRange.end}
                onChange={(next) => {
                  const start = typeof next?.startIndex === "number" ? next.startIndex : brushRange.start;
                  const end = typeof next?.endIndex === "number" ? next.endIndex : brushRange.end;
                  setBrushRange({ start, end });
                }}
                tickFormatter={(val) => formatDateByLocale(new Date(Number(val)).toISOString().slice(0, 10), locale)}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="h-[90px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows} syncId="bt-chart" margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
            <XAxis
              dataKey="ts"
              type="number"
              domain={["dataMin", "dataMax"]}
              tick={{ fontSize: 10, fill: axisColor }}
              tickLine={false}
              axisLine={false}
              minTickGap={26}
              tickFormatter={(val) => formatDateByLocale(new Date(Number(val)).toISOString().slice(0, 10), locale)}
            />
            <YAxis
              tick={{ fontSize: 10, fill: axisColor }}
              tickLine={false}
              axisLine={false}
              width={56}
              domain={[Math.min(minDrawdown - 0.5, -0.5), 0]}
              tickFormatter={(v) => `${Number(v).toFixed(1)}%`}
            />
            <Tooltip content={<CustomTooltip locale={locale} />} cursor={{ stroke: cursorColor, strokeWidth: 1 }} />
            <Area
              type="monotone"
              dataKey="drawdownPct"
              stroke="#6366f1"
              strokeWidth={1}
              fill={COLOR_PRESET.drawdown}
              name={locale === "zh" ? "回撤" : "Drawdown"}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: palette.up }} />
          {locale === "zh" ? "买点" : "Buy"}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: palette.down }} />
          {locale === "zh" ? "卖点" : "Sell"}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-2 rounded-sm" style={{ backgroundColor: palette.holdUp }} />
          {locale === "zh" ? "持仓正收益区间" : "Positive holding interval"}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-2 rounded-sm" style={{ backgroundColor: palette.holdDown }} />
          {locale === "zh" ? "持仓负收益区间" : "Negative holding interval"}
        </span>
      </div>
    </div>
  );
}
