import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/contexts/I18nContext";
import { useChartColor } from "@/contexts/ChartColorContext";
import { useTheme } from "@/contexts/ThemeContext";
import { formatDateByLocale } from "@/lib/date";
import type { TradeRecord } from "@/lib/api";

interface EquityChartProps {
  data: Array<{ t?: number; v?: number; timestamp?: string; value?: number }> | null;
  trades?: TradeRecord[] | null;
  selectedTrade?: TradeRecord | null;
  loading: boolean;
}

type ChartRow = {
  ts: number;
  day: string;
  equity: number;
  returnPct: number;
  buyCount: number;
  sellCount: number;
  buyTrades: TradeRecord[];
  sellTrades: TradeRecord[];
  inPositionStart: boolean;
  inPositionEnd: boolean;
};

type PositionBand = {
  x1: number;
  x2: number;
  positive: boolean;
};

function formatMoney(value: number): string {
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function formatPct(value: number): string {
  return `${value.toFixed(2)}%`;
}

function toUtcDayString(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function toDay(raw: string): string {
  if (!raw) return "";
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const ts = Date.parse(s);
  if (!Number.isFinite(ts)) return "";
  return toUtcDayString(new Date(ts));
}

function toTs(day: string): number {
  const parts = day.split("-");
  if (parts.length !== 3) return Number.NaN;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return Number.NaN;
  return Date.UTC(y, m - 1, d);
}

function dayFromTs(ts: number): string {
  if (!Number.isFinite(ts)) return "";
  return toUtcDayString(new Date(ts));
}

type TradeAction = "buy" | "sell" | null;

function classifyTradeAction(actionRaw: string): TradeAction {
  const action = actionRaw.trim().toUpperCase();
  if (!action) return null;
  if (action.includes("BUY") || action.includes("BTO") || action.includes("BOT")) return "buy";
  if (action.includes("SELL") || action.includes("STC") || action.includes("SLD")) return "sell";
  return null;
}

function computeYDomain(rows: ChartRow[]): [number, number] {
  const values = rows.map((d) => d.returnPct).filter(Number.isFinite);
  if (values.length === 0) return [-1, 1];

  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);

  if (minVal === maxVal) {
    const pad = Math.max(Math.abs(minVal) * 0.1, 0.2);
    return [minVal - pad, maxVal + pad];
  }

  const range = maxVal - minVal;
  const pad = Math.max(range * 0.12, 0.18);
  const yMin = Math.min(minVal - pad, 0);
  const yMax = Math.max(maxVal + pad, 0);
  return [yMin, yMax];
}

function buildPositionBands(rows: ChartRow[]): PositionBand[] {
  const bands: PositionBand[] = [];
  let startTs: number | null = null;
  let startReturn = 0;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const startsToday = !row.inPositionStart && row.inPositionEnd;
    const carriesToday = row.inPositionStart;
    const closesToday = row.inPositionStart && !row.inPositionEnd;
    const isLast = i === rows.length - 1;

    if ((startsToday || carriesToday) && startTs === null) {
      startTs = row.ts;
      startReturn = row.returnPct;
    }

    if (startTs !== null && closesToday) {
      bands.push({ x1: startTs, x2: row.ts, positive: row.returnPct >= startReturn });
      startTs = null;
    } else if (startTs !== null && isLast) {
      bands.push({ x1: startTs, x2: row.ts, positive: row.returnPct >= startReturn });
      startTs = null;
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

function BuyDot(props: any, color: string) {
  const { cx, cy, payload } = props;
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || !payload?.buyCount) return null;
  return <circle cx={cx} cy={cy} r={3.5} fill={color} stroke="white" strokeWidth={1} />;
}

function SellDot(props: any, color: string) {
  const { cx, cy, payload } = props;
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || !payload?.sellCount) return null;
  return <circle cx={cx} cy={cy} r={3.5} fill={color} stroke="white" strokeWidth={1} />;
}

function formatTradeDetail(trade: TradeRecord, action: "buy" | "sell", locale: string): string {
  const actionText = locale === "zh" ? (action === "buy" ? "买入" : "卖出") : (action === "buy" ? "Buy" : "Sell");
  const price = Number(trade.price);
  const priceText = Number.isFinite(price)
    ? `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "-";
  return `${actionText} ${trade.symbol} ${priceText}`;
}

export default function EquityChart({ data, trades, selectedTrade, loading }: EquityChartProps) {
  const { locale } = useI18n();
  const { palette } = useChartColor();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [animateIntro, setAnimateIntro] = useState(true);

  const rows = useMemo(() => {
    if (!data || data.length === 0) return [] as ChartRow[];

    const equityByDay = new Map<string, number>();
    for (const point of data) {
      const raw = point.timestamp ?? (typeof point.t === "number" ? new Date(point.t).toISOString() : "");
      const day = toDay(raw);
      const ts = toTs(day);
      const val = Number(point.value ?? point.v ?? 0);
      if (day && Number.isFinite(ts) && Number.isFinite(val)) equityByDay.set(day, val);
    }

    const tradesByDay = new Map<string, TradeRecord[]>();
    const sortedTrades = [...(trades || [])].sort((a, b) => {
      const aTs = Date.parse(a.timestamp || a.exitTime || a.entryTime || "");
      const bTs = Date.parse(b.timestamp || b.exitTime || b.entryTime || "");
      const safeA = Number.isFinite(aTs) ? aTs : 0;
      const safeB = Number.isFinite(bTs) ? bTs : 0;
      return safeA - safeB;
    });

    for (const trade of sortedTrades) {
      const tradeTs = trade.timestamp || trade.exitTime || trade.entryTime || "";
      const day = toDay(tradeTs);
      if (!day) continue;
      const arr = tradesByDay.get(day) ?? [];
      arr.push(trade);
      tradesByDay.set(day, arr);
    }

    const sortedDays = Array.from(equityByDay.keys()).sort();
    if (sortedDays.length === 0) return [] as ChartRow[];

    const base = Number(equityByDay.get(sortedDays[0]) ?? 0);
    if (!Number.isFinite(base) || base === 0) return [] as ChartRow[];

    const hasAnyBuy = sortedTrades.some((t) => classifyTradeAction(String(t.action || "")) === "buy");
    const hasAnySell = sortedTrades.some((t) => classifyTradeAction(String(t.action || "")) === "sell");
    let position = !hasAnyBuy && hasAnySell ? 1 : 0;

    const built: ChartRow[] = [];
    for (const day of sortedDays) {
      const equity = Number(equityByDay.get(day) ?? 0);
      const returnPct = ((equity / base) - 1) * 100;
      const dayTrades = tradesByDay.get(day) ?? [];
      const inPositionStart = position > 0;

      let buyCount = 0;
      let sellCount = 0;
      const buyTrades: TradeRecord[] = [];
      const sellTrades: TradeRecord[] = [];
      for (const trade of dayTrades) {
        const action = classifyTradeAction(String(trade.action || ""));
        if (action === "buy") {
          buyCount += 1;
          buyTrades.push(trade);
          position += 1;
        } else if (action === "sell") {
          sellCount += 1;
          sellTrades.push(trade);
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
        buyTrades,
        sellTrades,
        inPositionStart,
        inPositionEnd: position > 0,
      });
    }

    return built;
  }, [data, trades]);

  useEffect(() => {
    if (rows.length > 1) setAnimateIntro(true);
  }, [rows.length, rows[0]?.ts, rows[rows.length - 1]?.ts]);

  const bands = useMemo(() => buildPositionBands(rows), [rows]);
  const [yMin, yMax] = useMemo(() => computeYDomain(rows), [rows]);

  if (loading) return <SkeletonChart />;
  if (rows.length === 0) return null;

  const curveColor = isDark ? "#e4e4e7" : "#111111";
  const buyColor = palette.up;
  const sellColor = palette.down;

  const gridColor = isDark ? "#27272a" : "#eceff3";
  const axisColor = isDark ? "#a1a1aa" : "#64748b";

  const disableAnimationOnInteract = useCallback(() => {
    setAnimateIntro((prev) => (prev ? false : prev));
  }, []);

  const dotRenderer = useCallback(
    (props: any) => (
      <g>
        {BuyDot(props, buyColor)}
        {SellDot(props, sellColor)}
      </g>
    ),
    [buyColor, sellColor]
  );

  const selectedTradeMarker = useMemo(() => {
    if (!selectedTrade) return null;
    const rawTs = selectedTrade.timestamp || selectedTrade.exitTime || selectedTrade.entryTime || "";
    const day = toDay(rawTs);
    if (!day) return null;
    const row = rows.find((x) => x.day === day);
    if (!row) return null;
    const action = classifyTradeAction(String(selectedTrade.action || ""));
    if (!action) return null;
    return {
      ts: row.ts,
      day: row.day,
      symbol: selectedTrade.symbol,
      price: Number(selectedTrade.price),
      action,
      color: action === "buy" ? buyColor : sellColor,
    };
  }, [selectedTrade, rows, buyColor, sellColor]);

  const renderTooltip = useCallback(
    ({ active, payload }: any) => {
      if (!active || !payload?.length) return null;
      const lineEntry = payload.find((p: any) => p?.dataKey === "returnPct" && p?.value !== undefined);
      const row = (lineEntry?.payload ?? payload[0]?.payload) as ChartRow | undefined;
      if (!row) return null;

      return (
        <div className="rounded-md border border-border bg-background/95 px-2.5 py-1.5 text-xs text-foreground shadow-sm">
          <div className="font-medium">{formatDateByLocale(row.day, locale)}</div>
          <div>{locale === "zh" ? "策略净值" : "Equity"}: {formatMoney(row.equity)}</div>
          <div>{locale === "zh" ? "累计收益" : "Return"}: {formatPct(row.returnPct)}</div>
          {row.buyTrades.map((trade, idx) => (
            <div key={`buy-${trade.symbol}-${trade.timestamp}-${idx}`}>{formatTradeDetail(trade, "buy", locale)}</div>
          ))}
          {row.sellTrades.map((trade, idx) => (
            <div key={`sell-${trade.symbol}-${trade.timestamp}-${idx}`}>{formatTradeDetail(trade, "sell", locale)}</div>
          ))}
        </div>
      );
    },
    [locale]
  );

  return (
    <div className="border border-border rounded-lg p-4 bg-card space-y-3">
      <div className="relative h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={rows}
            margin={{ top: 8, right: 10, left: 2, bottom: 0 }}
            onMouseMove={disableAnimationOnInteract}
            onMouseEnter={disableAnimationOnInteract}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />

            {bands.map((band, idx) => (
              <ReferenceArea
                key={`${band.x1}-${band.x2}-${idx}`}
                x1={band.x1}
                x2={band.x2}
                y1={yMin}
                y2={yMax}
                fill={band.positive ? palette.holdUp : palette.holdDown}
                strokeOpacity={0}
              />
            ))}
            {selectedTradeMarker ? (
              <ReferenceLine
                x={selectedTradeMarker.ts}
                stroke={selectedTradeMarker.color}
                strokeDasharray="4 3"
                strokeOpacity={0.9}
              />
            ) : null}

            <XAxis
              dataKey="ts"
              type="number"
              domain={["dataMin", "dataMax"]}
              padding={{ left: 0, right: 0 }}
              tick={{ fontSize: 10, fill: axisColor }}
              tickLine={false}
              axisLine={false}
              minTickGap={26}
              tickFormatter={(val) => formatDateByLocale(dayFromTs(Number(val)), locale)}
            />
            <YAxis
              tick={{ fontSize: 10, fill: axisColor }}
              tickLine={false}
              axisLine={false}
              width={56}
              domain={[yMin, yMax]}
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
              baseValue={yMin}
              stroke="none"
              fill={isDark ? "rgba(148,163,184,0.18)" : "rgba(148,163,184,0.14)"}
              isAnimationActive={animateIntro}
              animationDuration={650}
              animationEasing="ease-out"
              tooltipType="none"
            />

            <Line
              type="monotone"
              dataKey="returnPct"
              stroke={curveColor}
              strokeWidth={1.9}
              dot={dotRenderer}
              activeDot={false}
              isAnimationActive={animateIntro}
              animationDuration={780}
              animationEasing="ease-out"
              onAnimationEnd={() => setAnimateIntro(false)}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {selectedTradeMarker ? (
        <div
          className="rounded-md border border-border bg-background/95 px-2.5 py-1.5 text-xs text-foreground shadow-sm"
          style={{ borderLeftColor: selectedTradeMarker.color, borderLeftWidth: 2 }}
        >
          <div className="font-medium">{formatDateByLocale(selectedTradeMarker.day, locale)}</div>
          <div>
            {locale === "zh"
              ? `${selectedTradeMarker.action === "buy" ? "买入" : "卖出"} ${selectedTradeMarker.symbol} ${Number.isFinite(selectedTradeMarker.price) ? `$${selectedTradeMarker.price.toFixed(2)}` : "-"}`
              : `${selectedTradeMarker.action === "buy" ? "Buy" : "Sell"} ${selectedTradeMarker.symbol} ${Number.isFinite(selectedTradeMarker.price) ? `$${selectedTradeMarker.price.toFixed(2)}` : "-"}`}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: buyColor }} />{locale === "zh" ? "买点" : "Buy"}</span>
        <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: sellColor }} />{locale === "zh" ? "卖点" : "Sell"}</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-2 rounded-sm" style={{ backgroundColor: palette.holdUp }} />{locale === "zh" ? "持仓正收益区间" : "Positive holding interval"}</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-2 rounded-sm" style={{ backgroundColor: palette.holdDown }} />{locale === "zh" ? "持仓负收益区间" : "Negative holding interval"}</span>
      </div>
    </div>
  );
}
