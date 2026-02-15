import {
  Area,
  AreaChart,
  Brush,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  XAxis,
  YAxis,
} from "recharts";
import { useEffect, useMemo, useRef, useState } from "react";
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

function getSmartPresetByLength(length: number): WindowPreset {
  if (length < 63) return "all";
  if (length < 126) return "3m";
  if (length < 252) return "6m";
  if (length <= 300) return "1y";
  return "all";
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
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const [pinnedPos, setPinnedPos] = useState<{ x: number; y: number } | null>(null);
  const userChangedPresetRef = useRef(false);

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

  const activeInfo = pinnedRow ?? hoverRow;
  const activePos = pinnedPos ?? hoverPos;

  const presetPoints: Record<WindowPreset, number> = {
    "3m": 63,
    "6m": 126,
    "1y": 252,
    all: Number.POSITIVE_INFINITY,
  };
  const isPresetAllowed = (preset: WindowPreset, length: number): boolean => {
    if (preset === "all") return true;
    return length >= presetPoints[preset];
  };

  useEffect(() => {
    if (rows.length === 0) {
      setBrushRange({ start: 0, end: 0 });
      return;
    }
    if (!userChangedPresetRef.current) {
      setWindowPreset(getSmartPresetByLength(rows.length));
    }
  }, [rows.length]);

  useEffect(() => {
    if (rows.length === 0) return;
    if (!isPresetAllowed(windowPreset, rows.length)) {
      setWindowPreset(getSmartPresetByLength(rows.length));
    }
  }, [rows.length, windowPreset]);

  useEffect(() => {
    if (rows.length <= 1) {
      setBrushRange({ start: 0, end: 0 });
      return;
    }
    const last = rows.length - 1;
    const points = presetPoints[windowPreset];
    if (!Number.isFinite(points) || rows.length <= points) {
      setBrushRange({ start: 0, end: Math.max(1, last) });
      return;
    }
    const start = Math.max(0, Math.min(rows.length - points, last - 1));
    const end = Math.max(start + 1, last);
    setBrushRange({ start, end });
  }, [rows.length, windowPreset]);

  if (loading) return <SkeletonChart />;
  if (rows.length === 0) return null;

  const gridColor = isDark ? "#27272a" : "#eceff3";
  const axisColor = isDark ? "#a1a1aa" : "#64748b";
  const maxIndex = rows.length - 1;
  const hasBrush = maxIndex > 0;
  const safeBrushStart = !hasBrush ? 0 : Math.min(Math.max(0, brushRange.start), maxIndex - 1);
  const safeBrushEnd = !hasBrush ? 0 : Math.min(Math.max(safeBrushStart + 1, brushRange.end), maxIndex);
  const visibleRows = hasBrush ? rows.slice(safeBrushStart, safeBrushEnd + 1) : rows;
  const visibleBands = useMemo(() => buildPositionBands(visibleRows), [visibleRows]);
  const visibleTsStart = visibleRows[0]?.ts ?? null;
  const visibleTsEnd = visibleRows[visibleRows.length - 1]?.ts ?? null;
  const activeInfoInView = !!activeInfo && visibleTsStart !== null && visibleTsEnd !== null && activeInfo.ts >= visibleTsStart && activeInfo.ts <= visibleTsEnd;

  const tradeBuys = visibleRows.filter((d) => d.buyCount > 0).map((d) => ({ ...d, markerY: d.returnPct }));
  const tradeSells = visibleRows.filter((d) => d.sellCount > 0).map((d) => ({ ...d, markerY: d.returnPct }));
  const returnValues = visibleRows.map((d) => d.returnPct);
  const drawdownValues = visibleRows.map((d) => d.drawdownPct);
  const minReturn = Math.min(...returnValues);
  const maxReturn = Math.max(...returnValues);
  const minDrawdown = Math.min(...drawdownValues);

  const presetButtons: Array<{ key: WindowPreset; label: string }> = [
    { key: "3m", label: t("strategy.backtestPreset3m") },
    { key: "6m", label: t("strategy.backtestPreset6m") },
    { key: "1y", label: t("strategy.backtestPreset1y") },
    { key: "all", label: t("strategy.backtestPresetAll") },
  ];
  const visiblePresetButtons = presetButtons.filter((preset) => isPresetAllowed(preset.key, rows.length));

  return (
    <div className="border border-border rounded-lg p-4 bg-card space-y-3">
      <div className="flex items-center justify-end gap-1.5">
        {visiblePresetButtons.map((preset) => {
          const active = windowPreset === preset.key;
          return (
            <button
              key={preset.key}
              type="button"
              onClick={() => {
                userChangedPresetRef.current = true;
                setWindowPreset(preset.key);
              }}
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
        <div className="relative h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={visibleRows}
              syncId="bt-chart"
              margin={{ top: 6, right: 10, left: 2, bottom: 0 }}
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
                  setSelectedTradeRow(null);
                  return;
                }
                if (!row) return;
                setPinnedRow(row);
                setSelectedTradeRow(null);
                if (typeof state?.chartX === "number" && typeof state?.chartY === "number") {
                  setPinnedPos({ x: state.chartX, y: state.chartY });
                } else {
                  setPinnedPos(null);
                }
              }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
              {visibleBands.map((band, idx) => (
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
                padding={{ left: 6, right: 6 }}
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
                label={{
                  value: locale === "zh" ? "绱鏀剁泭 (%)" : "Return (%)",
                  angle: -90,
                  position: "insideLeft",
                  offset: 4,
                  fill: axisColor,
                  fontSize: 10,
                }}
              />
              {activeInfoInView ? (
                <ReferenceLine
                  x={activeInfo!.ts}
                  stroke={isDark ? "#71717a" : "#94a3b8"}
                  strokeDasharray="3 3"
                  strokeOpacity={0.75}
                />
              ) : null}

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
                  if (pinnedRow) {
                    setPinnedRow(null);
                    setPinnedPos(null);
                    setSelectedTradeRow(null);
                    return;
                  }
                  const row = point?.payload as ChartRow | undefined;
                  if (!row) return;
                  setSelectedTradeRow(row);
                  setPinnedRow(row);
                  if (typeof point?.cx === "number" && typeof point?.cy === "number") {
                    setPinnedPos({ x: point.cx, y: point.cy });
                  } else {
                    setPinnedPos(null);
                  }
                }}
              />

              <Scatter
                yAxisId="return"
                data={tradeSells}
                dataKey="markerY"
                fill={palette.down}
                shape={<SellDot />}
                onClick={(point: any) => {
                  if (pinnedRow) {
                    setPinnedRow(null);
                    setPinnedPos(null);
                    setSelectedTradeRow(null);
                    return;
                  }
                  const row = point?.payload as ChartRow | undefined;
                  if (!row) return;
                  setSelectedTradeRow(row);
                  setPinnedRow(row);
                  if (typeof point?.cx === "number" && typeof point?.cy === "number") {
                    setPinnedPos({ x: point.cx, y: point.cy });
                  } else {
                    setPinnedPos(null);
                  }
                }}
              />
            </ComposedChart>
          </ResponsiveContainer>
          {activeInfo && activePos && activeInfoInView && (
            <div
              className="pointer-events-none absolute z-20 flex flex-col gap-2"
              style={{
                left: `${activePos.x + 14}px`,
                top: `${Math.max(8, activePos.y - 18)}px`,
              }}
            >
              <div className="rounded-md border border-border bg-background/95 px-2.5 py-1.5 text-xs text-foreground shadow-sm backdrop-blur-[1px]">
                <div className="font-medium">
                  {formatDateByLocale(activeInfo.day, locale)}
                  {pinnedRow ? (locale === "zh" ? "（已固定）" : " (Pinned)") : ""}
                </div>
                <div>{locale === "zh" ? "策略净值" : "Equity"}: {formatMoney(activeInfo.equity)}</div>
                <div>{locale === "zh" ? "累计收益" : "Return"}: {formatPct(activeInfo.returnPct)}</div>
                <div>{locale === "zh" ? "回撤" : "Drawdown"}: {formatPct(activeInfo.drawdownPct)}</div>
              </div>
              {pinnedRow && selectedTradeRow && selectedTradeRow.day === activeInfo.day && selectedTradeRow.trades.length > 0 ? (
                <div className="rounded-md border border-border bg-background/95 px-2.5 py-1.5 text-xs text-foreground shadow-sm backdrop-blur-[1px]">
                  <div className="mb-1 font-medium">{locale === "zh" ? "交易详情" : "Trade Details"}</div>
                  <div className="space-y-1 text-muted-foreground">
                    {selectedTradeRow.trades.map((trade, idx) => (
                      <div key={`${trade.timestamp}-${idx}`}>
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
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <div>
        <div className="h-[82px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={visibleRows} syncId="bt-chart" margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
              <XAxis dataKey="ts" type="number" domain={["dataMin", "dataMax"]} hide />
              <YAxis
                tick={{ fontSize: 10, fill: axisColor }}
                tickLine={false}
                axisLine={false}
                width={56}
                domain={[Math.min(minDrawdown - 0.5, -0.5), 0]}
                tickFormatter={(v) => `${Number(v).toFixed(1)}%`}
                label={{
                  value: locale === "zh" ? "鍥炴挙 (%)" : "Drawdown (%)",
                  angle: -90,
                  position: "insideLeft",
                  offset: 4,
                  fill: axisColor,
                  fontSize: 10,
                }}
              />
              {activeInfoInView ? (
                <ReferenceLine
                  x={activeInfo!.ts}
                  stroke={isDark ? "#71717a" : "#94a3b8"}
                  strokeDasharray="3 3"
                  strokeOpacity={0.75}
                />
              ) : null}
              <Area type="monotone" dataKey="drawdownPct" stroke={COLOR_PRESET.drawdownLine} strokeWidth={1} fill={COLOR_PRESET.drawdownFill} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="equity-brush h-[48px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows} syncId="bt-chart" margin={{ top: 0, right: 10, left: 56, bottom: 2 }}>
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
            {hasBrush ? (
              <Brush
                dataKey="ts"
                height={24}
                stroke={isDark ? "#71717a" : "#94a3b8"}
                travellerWidth={8}
                startIndex={safeBrushStart}
                endIndex={safeBrushEnd}
                onChange={(next) => {
                  const nextStartRaw = typeof next?.startIndex === "number" ? next.startIndex : safeBrushStart;
                  const nextEndRaw = typeof next?.endIndex === "number" ? next.endIndex : safeBrushEnd;
                  const start = Math.min(Math.max(0, nextStartRaw), maxIndex - 1);
                  const end = Math.min(Math.max(start + 1, nextEndRaw), maxIndex);
                  setBrushRange({ start, end });
                }}
                tickFormatter={(val) => formatDateByLocale(new Date(Number(val)).toISOString().slice(0, 10), locale)}
              />
            ) : null}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-[2px] rounded-full bg-black" />
          {locale === "zh" ? "绛栫暐绱鏀剁泭" : "Strategy Return"}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: palette.up }} />
          {locale === "zh" ? "涔扮偣" : "Buy"}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: palette.down }} />
          {locale === "zh" ? "鍗栫偣" : "Sell"}
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
