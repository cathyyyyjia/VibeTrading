import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  XAxis,
  YAxis,
} from "recharts";
import { useMemo, useState } from "react";
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
};

const CURVE_COLOR = "#111111";
const BUY_COLOR = "#16a34a";
const SELL_COLOR = "#dc2626";

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

function SkeletonChart() {
  return (
    <div className="border border-border rounded-lg p-4 bg-card">
      <div className="h-[320px] bg-muted/30 rounded animate-pulse" />
    </div>
  );
}

function BuyDot(props: any) {
  const { cx, cy, payload } = props;
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || !payload?.buyCount) return null;
  return <circle cx={cx} cy={cy} r={3.5} fill={BUY_COLOR} stroke="white" strokeWidth={1} />;
}

function SellDot(props: any) {
  const { cx, cy, payload } = props;
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || !payload?.sellCount) return null;
  return <circle cx={cx} cy={cy} r={3.5} fill={SELL_COLOR} stroke="white" strokeWidth={1} />;
}

export default function EquityChart({ data, trades, loading }: EquityChartProps) {
  const { locale } = useI18n();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [hoverRow, setHoverRow] = useState<ChartRow | null>(null);
  const [pinnedRow, setPinnedRow] = useState<ChartRow | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const [pinnedPos, setPinnedPos] = useState<{ x: number; y: number } | null>(null);

  const rows = useMemo<ChartRow[]>(() => {
    if (!data || data.length === 0) return [];

    const equityByDay = new Map<string, number>();
    for (const point of data) {
      const raw = point.timestamp ?? (typeof point.t === "number" ? new Date(point.t).toISOString() : "");
      const day = toDay(raw);
      const val = Number(point.value ?? point.v ?? 0);
      if (day && Number.isFinite(val)) equityByDay.set(day, val);
    }

    const tradesByDay = new Map<string, { buyCount: number; sellCount: number }>();
    for (const trade of trades || []) {
      const day = toDay(trade.timestamp || trade.entryTime || "");
      if (!day) continue;
      const current = tradesByDay.get(day) ?? { buyCount: 0, sellCount: 0 };
      const action = String(trade.action || "").toUpperCase();
      if (action.includes("BUY")) current.buyCount += 1;
      if (action.includes("SELL")) current.sellCount += 1;
      tradesByDay.set(day, current);
    }

    const sortedDays = Array.from(equityByDay.keys()).sort();
    if (sortedDays.length === 0) return [];

    const base = Number(equityByDay.get(sortedDays[0]) ?? 0);
    if (!Number.isFinite(base) || base === 0) return [];

    const built: ChartRow[] = sortedDays.map((day) => {
      const equity = Number(equityByDay.get(day) ?? 0);
      const returnPct = ((equity / base) - 1) * 100;
      const counts = tradesByDay.get(day) ?? { buyCount: 0, sellCount: 0 };
      return {
        ts: toTs(day),
        day,
        equity,
        returnPct,
        buyCount: counts.buyCount,
        sellCount: counts.sellCount,
      };
    });

    return downsampleRows(built, 1200);
  }, [data, trades]);

  if (loading) return <SkeletonChart />;
  if (rows.length === 0) return null;

  const activeInfo = pinnedRow ?? hoverRow;
  const activePos = pinnedPos ?? hoverPos;

  const yValues = rows.map((d) => d.returnPct);
  const yMin = Math.min(...yValues);
  const yMax = Math.max(...yValues);
  const tradeBuys = rows.filter((d) => d.buyCount > 0).map((d) => ({ ...d, markerY: d.returnPct }));
  const tradeSells = rows.filter((d) => d.sellCount > 0).map((d) => ({ ...d, markerY: d.returnPct }));

  const gridColor = isDark ? "#27272a" : "#eceff3";
  const axisColor = isDark ? "#a1a1aa" : "#64748b";

  return (
    <div className="border border-border rounded-lg p-4 bg-card">
      <div className="relative h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={rows}
            margin={{ top: 8, right: 10, left: 2, bottom: 0 }}
            onMouseMove={(state: any) => {
              if (pinnedRow) return;
              const row = state?.activePayload?.[0]?.payload as ChartRow | undefined;
              setHoverRow(row ?? null);
              if (row && typeof state?.chartX === "number" && typeof state?.chartY === "number") {
                setHoverPos({ x: state.chartX, y: state.chartY });
              } else {
                setHoverPos(null);
              }
            }}
            onMouseLeave={() => {
              if (!pinnedRow) {
                setHoverRow(null);
                setHoverPos(null);
              }
            }}
            onClick={(state: any) => {
              const row = state?.activePayload?.[0]?.payload as ChartRow | undefined;
              if (pinnedRow) {
                setPinnedRow(null);
                setPinnedPos(null);
                return;
              }
              if (!row) return;
              setPinnedRow(row);
              if (typeof state?.chartX === "number" && typeof state?.chartY === "number") {
                setPinnedPos({ x: state.chartX, y: state.chartY });
              } else {
                setPinnedPos(null);
              }
            }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
            <XAxis
              dataKey="ts"
              type="number"
              domain={["dataMin", "dataMax"]}
              padding={{ left: 6, right: 6 }}
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
            {activeInfo ? (
              <ReferenceLine
                x={activeInfo.ts}
                stroke={isDark ? "#71717a" : "#94a3b8"}
                strokeDasharray="3 3"
                strokeOpacity={0.75}
              />
            ) : null}

            <Line
              type="monotone"
              dataKey="returnPct"
              stroke={CURVE_COLOR}
              strokeWidth={1.9}
              dot={false}
              activeDot={{ r: 3.2, fill: CURVE_COLOR, strokeWidth: 0 }}
            />

            <Scatter
              data={tradeBuys}
              dataKey="markerY"
              shape={<BuyDot />}
              onClick={(point: any) => {
                if (pinnedRow) {
                  setPinnedRow(null);
                  setPinnedPos(null);
                  return;
                }
                const row = point?.payload as ChartRow | undefined;
                if (!row) return;
                setPinnedRow(row);
                if (typeof point?.cx === "number" && typeof point?.cy === "number") {
                  setPinnedPos({ x: point.cx, y: point.cy });
                }
              }}
            />

            <Scatter
              data={tradeSells}
              dataKey="markerY"
              shape={<SellDot />}
              onClick={(point: any) => {
                if (pinnedRow) {
                  setPinnedRow(null);
                  setPinnedPos(null);
                  return;
                }
                const row = point?.payload as ChartRow | undefined;
                if (!row) return;
                setPinnedRow(row);
                if (typeof point?.cx === "number" && typeof point?.cy === "number") {
                  setPinnedPos({ x: point.cx, y: point.cy });
                }
              }}
            />
          </ComposedChart>
        </ResponsiveContainer>

        {activeInfo && activePos && (
          <div
            className="pointer-events-none absolute z-20 rounded-md border border-border bg-background/95 px-2.5 py-1.5 text-xs text-foreground shadow-sm backdrop-blur-[1px]"
            style={{
              left: `${activePos.x + 14}px`,
              top: `${Math.max(8, activePos.y - 18)}px`,
            }}
          >
            <div className="font-medium">
              {formatDateByLocale(activeInfo.day, locale)}
              {pinnedRow ? (locale === "zh" ? "（已固定）" : " (Pinned)") : ""}
            </div>
            <div>{locale === "zh" ? "策略净值" : "Equity"}: {formatMoney(activeInfo.equity)}</div>
            <div>{locale === "zh" ? "累计收益" : "Return"}: {formatPct(activeInfo.returnPct)}</div>
            {activeInfo.buyCount > 0 ? <div>{locale === "zh" ? "买点" : "Buy"}: {activeInfo.buyCount}</div> : null}
            {activeInfo.sellCount > 0 ? <div>{locale === "zh" ? "卖点" : "Sell"}: {activeInfo.sellCount}</div> : null}
          </div>
        )}
      </div>
    </div>
  );
}
