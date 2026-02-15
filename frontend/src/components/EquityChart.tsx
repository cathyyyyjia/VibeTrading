import {
  Area,
  AreaChart,
  Brush,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Scatter,
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
  symbol: string;
  price: number;
  timestamp: string;
  pnl: number | null;
  reason: string | null;
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
  curve: "#111111",
  drawdownLine: "#334155",
  drawdownFill: "rgba(100, 116, 139, 0.14)",
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
      <div className="h-[390px] bg-muted/30 rounded animate-pulse" />
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

export default function EquityChart({ data, trades, loading }: EquityChartProps) {
  const { locale, t } = useI18n();
  const { theme } = useTheme();
  const { palette } = useChartColor();
  const isDark = theme === "dark";

  const [windowPreset, setWindowPreset] = useState<WindowPreset>("6m");
  const [brushRange, setBrushRange] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  const [hoverRow, setHoverRow] = useState<ChartRow | null>(null);
  const [pinnedRow, setPinnedRow] = useState<ChartRow | null>(null);
  const [selectedTradeRow, setSelectedTradeRow] = useState<ChartRow | null>(null);

  const rows = useMemo<ChartRow[]>(() => {
    if (!data || data.length === 0) return [];

    const equityByDay = new Map<string, number>();
    for (const point of data) {
      const raw = point.timestamp ?? (typeof point.t === "number" ? new Date(point.t).toISOString() : "");
      const day = toDay(raw);
      const val = Number(point.value ?? point.v ?? 0);
      if (day && Number.isFinite(val)) equityByDay.set(day, val);
    }

    const tradesByDay = new Map<string, TradePoint[]>();
    for (const trade of trades || []) {
      const day = toDay(trade.timestamp || trade.entryTime || "");
      if (!day) continue;
      const next = tradesByDay.get(day) ?? [];
      next.push({
        action: String(trade.action || "").toUpperCase(),
        symbol: trade.symbol || "-",
        price: Number(trade.price || 0),
        timestamp: trade.timestamp || trade.entryTime || "",
        pnl: typeof trade.pnl === "number" ? trade.pnl : null,
        reason: trade.reason || null,
      });
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
  const activeInfo = pinnedRow ?? hoverRow;

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

      <div>
        <div className="mb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          {locale === "zh" ? "策略累计收益" : "Strategy Return"}
        </div>
        {activeInfo && (
          <div className="mb-2 inline-flex flex-col rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-xs text-foreground">
            <div className="font-medium">
              {formatDateByLocale(activeInfo.day, locale)}
              {pinnedRow ? (locale === "zh" ? "（已固定）" : " (Pinned)") : ""}
            </div>
            <div>{locale === "zh" ? "策略净值" : "Equity"}: {formatMoney(activeInfo.equity)}</div>
            <div>{locale === "zh" ? "累计收益" : "Return"}: {formatPct(activeInfo.returnPct)}</div>
            <div>{locale === "zh" ? "回撤" : "Drawdown"}: {formatPct(activeInfo.drawdownPct)}</div>
          </div>
        )}
        <div className="h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={rows}
              syncId="bt-chart"
              margin={{ top: 6, right: 10, left: 0, bottom: 0 }}
              onMouseMove={(state: any) => {
                if (pinnedRow) return;
                const row = state?.activePayload?.[0]?.payload as ChartRow | undefined;
                setHoverRow(row ?? null);
              }}
              onMouseLeave={() => {
                if (!pinnedRow) setHoverRow(null);
              }}
              onClick={(state: any) => {
                const row = state?.activePayload?.[0]?.payload as ChartRow | undefined;
                if (!row) return;
                setPinnedRow((prev) => (prev?.ts === row.ts ? null : row));
              }}
            >
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

              <Line
                yAxisId="return"
                type="monotone"
                dataKey="returnPct"
                stroke={COLOR_PRESET.curve}
                strokeWidth={1.9}
                dot={false}
                activeDot={{ r: 3.2, fill: COLOR_PRESET.curve, strokeWidth: 0 }}
              />

              <Scatter
                yAxisId="return"
                data={tradeBuys}
                dataKey="markerY"
                fill={palette.up}
                shape={<BuyDot />}
                onClick={(point: any) => {
                  const row = point?.payload as ChartRow | undefined;
                  if (!row) return;
                  setSelectedTradeRow(row);
                  setPinnedRow(row);
                }}
              />

              <Scatter
                yAxisId="return"
                data={tradeSells}
                dataKey="markerY"
                fill={palette.down}
                shape={<SellDot />}
                onClick={(point: any) => {
                  const row = point?.payload as ChartRow | undefined;
                  if (!row) return;
                  setSelectedTradeRow(row);
                  setPinnedRow(row);
                }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div>
        <div className="mb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          {locale === "zh" ? "回撤" : "Drawdown"}
        </div>
        <div className="h-[82px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rows} syncId="bt-chart" margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
              <XAxis dataKey="ts" type="number" domain={["dataMin", "dataMax"]} hide />
              <YAxis
                tick={{ fontSize: 10, fill: axisColor }}
                tickLine={false}
                axisLine={false}
                width={56}
                domain={[Math.min(minDrawdown - 0.5, -0.5), 0]}
                tickFormatter={(v) => `${Number(v).toFixed(1)}%`}
              />
              <Area type="monotone" dataKey="drawdownPct" stroke={COLOR_PRESET.drawdownLine} strokeWidth={1} fill={COLOR_PRESET.drawdownFill} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="h-[48px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows} syncId="bt-chart" margin={{ top: 0, right: 10, left: 0, bottom: 2 }}>
            <XAxis
              dataKey="ts"
              type="number"
              domain={["dataMin", "dataMax"]}
              tick={false}
              tickLine={false}
              axisLine={false}
            />
            <YAxis hide />
            <Area type="monotone" dataKey="returnPct" stroke="#94a3b8" strokeWidth={1} fill="rgba(148, 163, 184, 0.12)" />
            <Brush
              dataKey="ts"
              height={24}
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
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-[2px] rounded-full bg-black" />
          {locale === "zh" ? "策略累计收益" : "Strategy Return"}
        </span>
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

      {selectedTradeRow && selectedTradeRow.trades.length > 0 && (
        <div className="rounded-md border border-border bg-muted/25 p-3">
          <div className="mb-2 text-xs font-semibold text-foreground">
            {locale === "zh" ? "交易详情" : "Trade Details"} · {formatDateByLocale(selectedTradeRow.day, locale)}
          </div>
          <div className="space-y-1.5">
            {selectedTradeRow.trades.map((trade, idx) => (
              <div key={`${trade.timestamp}-${idx}`} className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{trade.symbol}</span>
                {" · "}
                <span>{trade.action}</span>
                {" · "}
                <span>{formatMoney(trade.price)}</span>
                {typeof trade.pnl === "number" ? (
                  <>
                    {" · "}
                    <span>{locale === "zh" ? "盈亏" : "PnL"}: {formatMoney(trade.pnl)}</span>
                  </>
                ) : null}
                {trade.reason ? (
                  <>
                    {" · "}
                    <span>{locale === "zh" ? "原因" : "Reason"}: {trade.reason}</span>
                  </>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

