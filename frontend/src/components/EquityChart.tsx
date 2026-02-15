import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
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
  ts: number;
  day: string;
  equity: number;
  returnPct: number;
  buyCount: number;
  sellCount: number;
  inPosition: boolean;
};

type TradeMarker = {
  ts: number;
  markerY: number;
  action: "BUY" | "SELL";
};

type PositionBand = {
  x1: number;
  x2: number;
  positive: boolean;
};

const CURVE_COLOR = "#111111";
const BUY_COLOR = "#16a34a";
const SELL_COLOR = "#dc2626";
const HOLD_UP = "rgba(22, 163, 74, 0.10)";
const HOLD_DOWN = "rgba(220, 38, 38, 0.08)";

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
  return Array.from(keep).sort((a, b) => a - b).map((idx) => rows[idx]);
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
      bands.push({ x1: start.ts, x2: end.ts, positive: end.returnPct >= start.returnPct });
      startIdx = null;
    }
  }
  return bands;
}

function SkeletonChart() {
  return (
    <div className="border border-border rounded-lg p-4 bg-card">
      <div className="h-[320px] bg-muted/30 rounded animate-pulse" />
    </div>
  );
}

function BuyDot(props: any) {
  const { cx, cy, payload } = props;
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || payload?.action !== "BUY") return null;
  return <circle cx={cx} cy={cy} r={3.5} fill={BUY_COLOR} stroke="white" strokeWidth={1} />;
}

function SellDot(props: any) {
  const { cx, cy, payload } = props;
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || payload?.action !== "SELL") return null;
  return <circle cx={cx} cy={cy} r={3.5} fill={SELL_COLOR} stroke="white" strokeWidth={1} />;
}

export default function EquityChart({ data, trades, loading }: EquityChartProps) {
  const { locale } = useI18n();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const { rows, tradeMarkers } = useMemo(() => {
    if (!data || data.length === 0) return { rows: [] as ChartRow[], tradeMarkers: [] as TradeMarker[] };

    const equityByDay = new Map<string, number>();
    for (const point of data) {
      const raw = point.timestamp ?? (typeof point.t === "number" ? new Date(point.t).toISOString() : "");
      const day = toDay(raw);
      const val = Number(point.value ?? point.v ?? 0);
      if (day && Number.isFinite(val)) equityByDay.set(day, val);
    }

    const tradesByDay = new Map<string, TradeRecord[]>();
    for (const trade of trades || []) {
      const ts = trade.timestamp || trade.entryTime || "";
      const day = toDay(ts);
      if (!day) continue;
      const arr = tradesByDay.get(day) ?? [];
      arr.push(trade);
      tradesByDay.set(day, arr);
    }

    const sortedDays = Array.from(equityByDay.keys()).sort();
    if (sortedDays.length === 0) return { rows: [] as ChartRow[], tradeMarkers: [] as TradeMarker[] };

    const base = Number(equityByDay.get(sortedDays[0]) ?? 0);
    if (!Number.isFinite(base) || base === 0) return { rows: [] as ChartRow[], tradeMarkers: [] as TradeMarker[] };

    const hasAnyBuy = (trades || []).some((t) => String(t.action || "").toUpperCase().includes("BUY"));
    const hasAnySell = (trades || []).some((t) => String(t.action || "").toUpperCase().includes("SELL"));
    let position = !hasAnyBuy && hasAnySell ? 1 : 0;
    const built: ChartRow[] = [];

    for (const day of sortedDays) {
      const equity = Number(equityByDay.get(day) ?? 0);
      const returnPct = ((equity / base) - 1) * 100;
      const dayTrades = tradesByDay.get(day) ?? [];
      let buyCount = 0;
      let sellCount = 0;

      for (const trade of dayTrades) {
        const action = String(trade.action || "").toUpperCase();
        if (action.includes("BUY")) {
          buyCount += 1;
          position += 1;
        } else if (action.includes("SELL")) {
          sellCount += 1;
          position = Math.max(0, position - 1);
        }
      }

      built.push({
        ts: toTs(day),
        day,
        equity,
        returnPct,
        buyCount,
        sellCount,
        inPosition: position > 0,
      });
    }

    const sampledRows = downsampleRows(built, 1200);
    const sampledDays = new Set(sampledRows.map((r) => r.day));
    const rowByDay = new Map(sampledRows.map((r) => [r.day, r]));

    const markers: TradeMarker[] = [];
    for (const trade of trades || []) {
      const tsRaw = trade.timestamp || trade.entryTime || "";
      const day = toDay(tsRaw);
      if (!day || !sampledDays.has(day)) continue;
      const row = rowByDay.get(day);
      if (!row) continue;
      const action = String(trade.action || "").toUpperCase();
      const markerTs = Number.isFinite(new Date(tsRaw).getTime()) ? new Date(tsRaw).getTime() : row.ts;
      if (action.includes("BUY")) {
        markers.push({ ts: markerTs, markerY: row.returnPct, action: "BUY" });
      } else if (action.includes("SELL")) {
        markers.push({ ts: markerTs, markerY: row.returnPct, action: "SELL" });
      }
    }

    return { rows: sampledRows, tradeMarkers: markers };
  }, [data, trades]);

  if (loading) return <SkeletonChart />;
  if (rows.length === 0) return null;

  const bands = buildPositionBands(rows);
  const yValues = rows.map((d) => d.returnPct);
  const yMin = Math.min(...yValues);
  const yMax = Math.max(...yValues);
  const buyMarkers = tradeMarkers.filter((m) => m.action === "BUY");
  const sellMarkers = tradeMarkers.filter((m) => m.action === "SELL");

  const gridColor = isDark ? "#27272a" : "#eceff3";
  const axisColor = isDark ? "#a1a1aa" : "#64748b";

  const renderTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const main = payload.find((p: any) => p?.dataKey === "returnPct")?.payload ?? payload[0]?.payload;
    const row = main as ChartRow | undefined;
    if (!row) return null;
    return (
      <div className="rounded-md border border-border bg-background/95 px-2.5 py-1.5 text-xs text-foreground shadow-sm">
        <div className="font-medium">{formatDateByLocale(row.day, locale)}</div>
        <div>{locale === "zh" ? "策略净值" : "Equity"}: {formatMoney(row.equity)}</div>
        <div>{locale === "zh" ? "累计收益" : "Return"}: {formatPct(row.returnPct)}</div>
        {row.buyCount > 0 ? <div>{locale === "zh" ? "买点" : "Buy"}: {row.buyCount}</div> : null}
        {row.sellCount > 0 ? <div>{locale === "zh" ? "卖点" : "Sell"}: {row.sellCount}</div> : null}
      </div>
    );
  };

  return (
    <div className="border border-border rounded-lg p-4 bg-card space-y-3">
      <div className="relative h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 10, left: 2, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />

            {bands.map((band, idx) => (
              <ReferenceArea
                key={`${band.x1}-${band.x2}-${idx}`}
                x1={band.x1}
                x2={band.x2}
                y1={Math.min(yMin - 0.5, -0.5)}
                y2={Math.max(yMax + 0.5, 0.5)}
                fill={band.positive ? HOLD_UP : HOLD_DOWN}
                strokeOpacity={0}
              />
            ))}

            <XAxis
              dataKey="ts"
              type="number"
              domain={["dataMin", "dataMax"]}
              padding={{ left: 10, right: 6 }}
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
              domain={[Math.min(yMin - 0.5, -0.5), Math.max(yMax + 0.5, 0.5)]}
              tickFormatter={(v) => `${Number(v).toFixed(1)}%`}
              label={{
                value: locale === "zh" ? "累计收益 (%)" : "Return (%)",
                angle: -90,
                position: "insideLeft",
                offset: 4,
                fill: axisColor,
                fontSize: 10,
              }}
            />

            <Tooltip
              cursor={{ stroke: isDark ? "#71717a" : "#94a3b8", strokeDasharray: "3 3", strokeOpacity: 0.75 }}
              content={renderTooltip}
            />

            <Area
              type="monotone"
              dataKey="returnPct"
              baseValue={Math.min(yMin - 0.5, -0.5)}
              stroke="none"
              fill={isDark ? "rgba(148,163,184,0.18)" : "rgba(148,163,184,0.14)"}
              isAnimationActive={false}
            />
            <Line type="monotone" dataKey="returnPct" stroke={CURVE_COLOR} strokeWidth={1.9} dot={false} activeDot={false} isAnimationActive={false} />

            <Scatter data={buyMarkers} dataKey="markerY" shape={<BuyDot />} isAnimationActive={false} />
            <Scatter data={sellMarkers} dataKey="markerY" shape={<SellDot />} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className="w-3 h-[2px] rounded-full bg-black" />{locale === "zh" ? "策略累计收益" : "Strategy Return"}</span>
        <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: BUY_COLOR }} />{locale === "zh" ? "买点" : "Buy"}</span>
        <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: SELL_COLOR }} />{locale === "zh" ? "卖点" : "Sell"}</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-2 rounded-sm" style={{ backgroundColor: HOLD_UP }} />{locale === "zh" ? "持仓正收益区间" : "Positive holding interval"}</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-2 rounded-sm" style={{ backgroundColor: HOLD_DOWN }} />{locale === "zh" ? "持仓负收益区间" : "Negative holding interval"}</span>
      </div>
    </div>
  );
}
