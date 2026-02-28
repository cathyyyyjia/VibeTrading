// ============================================================
// SimulationResult - Latest Simulation section
// Design: Swiss Precision - green dot, simulation ID, KPI + chart + table
// ============================================================

import { Sparkles } from 'lucide-react';
import KPICards from './KPICards';
import EquityChart from './EquityChart';
import TradeTable from './TradeTable';
import { useI18n } from '@/contexts/I18nContext';
import type { AppStatus } from '@/hooks/useBacktest';
import type { DivergenceSignal, IndicatorPreferences, RunReportResponse, TradeRecord } from '@/lib/api';
import { getRunArtifact } from '@/lib/api';
import { toast } from 'sonner';
import { useMemo, useState, useEffect } from 'react';

interface SimulationResultProps {
  report: RunReportResponse | null;
  status: AppStatus;
  runId: string | null;
  indicatorPreferences: IndicatorPreferences;
  backtestStartDate: string;
  backtestEndDate: string;
  dslOverride: Record<string, unknown> | null;
  onDslOverrideChange: (next: Record<string, unknown> | null) => void;
}

export default function SimulationResult({
  report,
  status,
  runId,
  indicatorPreferences,
  backtestStartDate,
  backtestEndDate,
  dslOverride,
  onDslOverrideChange,
}: SimulationResultProps) {
  const { t, locale } = useI18n();
  const [hoveredTrade, setHoveredTrade] = useState<TradeRecord | null>(null);
  const [pinnedTrade, setPinnedTrade] = useState<TradeRecord | null>(null);
  const [dslContent, setDslContent] = useState<any | null>(null);
  const [dslText, setDslText] = useState<string>("");
  const [dslTab, setDslTab] = useState<"view" | "explain" | "edit">("view");
  const [dslError, setDslError] = useState<string | null>(null);
  const isLoading = status === 'running' || status === 'analyzing';
  const showResult = status === 'analyzing' || status === 'running' || status === 'completed' || status === 'failed';
  const range = `${backtestStartDate} - ${backtestEndDate}`;
  const activeTrade = useMemo(() => hoveredTrade ?? pinnedTrade, [hoveredTrade, pinnedTrade]);
  const divergences = report?.divergences || [];
  const aiExplain = useMemo(() => buildDslExplanation(dslContent, locale), [dslContent, locale]);

  useEffect(() => {
    let cancelled = false;
    const loadDsl = async () => {
      if (!runId) return;
      try {
        const res = await getRunArtifact(runId, "dsl.json");
        if (cancelled) return;
        const content = res?.content ?? null;
        setDslContent(content);
        setDslText(content ? JSON.stringify(content, null, 2) : "");
        setDslError(null);
      } catch {
        if (!cancelled) setDslError(locale === "zh" ? "DSL 获取失败" : "Failed to load DSL");
      }
    };
    void loadDsl();
    return () => {
      cancelled = true;
    };
  }, [runId, locale]);

  const getTradeKey = (trade: TradeRecord | null) => {
    if (!trade) return "";
    return `${trade.timestamp}|${trade.entryTime ?? ""}|${trade.symbol}|${trade.action}|${trade.price}`;
  };

  if (!showResult) return null;

  return (
    <div className="space-y-4 mt-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${status === 'completed' ? 'bg-emerald-500' : (status === 'running' || status === 'analyzing') ? 'bg-amber-500 animate-pulse' : 'bg-red-500'}`} />
          <span className="text-sm font-semibold text-foreground">{t('sim.latestSimulation')}</span>
        </div>
        {runId && (
          <span className="text-xs text-muted-foreground font-mono">ID: {runId}</span>
        )}
        {isLoading && !runId && (
          <div className="h-3 w-20 bg-muted rounded animate-pulse" />
        )}
      </div>

      {/* Run Metadata */}
      <div className="border border-border rounded-lg bg-card p-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
          <div className="text-muted-foreground">
            {locale === "zh" ? "技术指标" : "Indicators"}: <span className="text-foreground">{(indicatorPreferences.indicatorKinds ?? ["MA", "MACD"]).join(", ")}</span>
          </div>
          <div className="text-muted-foreground">
            {locale === "zh" ? "回测时间" : "Backtest Window"}: <span className="text-foreground">{range}</span>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <KPICards kpis={report?.kpis || null} loading={isLoading && !report} />

      {/* AI Summary */}
      {report?.aiSummary && (
        <div className="border rounded-lg px-4 py-3 bg-violet-50/70 border-violet-200 dark:bg-violet-950/25 dark:border-violet-800">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-violet-700 dark:text-violet-300 mb-1">
            <Sparkles className="w-3.5 h-3.5" />
            {locale === "zh" ? t("sim.aiSummaryZh") : t("sim.aiSummaryEn")}
          </div>
          <p className="text-sm text-violet-900/90 dark:text-violet-100/90 leading-relaxed">
            {locale === "zh" ? (report.aiSummary.zh || report.aiSummary.en) : (report.aiSummary.en || report.aiSummary.zh)}
          </p>
        </div>
      )}

      {/* Equity Chart */}
      <EquityChart
        data={report?.equity || null}
        trades={report?.trades || null}
        divergences={divergences}
        selectedTrade={activeTrade}
        loading={isLoading && !report}
      />

      {/* DSL Viewer / AI Explain / Editor */}
      <div className="border border-border rounded-lg bg-card overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
          <div className="text-xs font-semibold text-foreground">DSL</div>
          <div className="flex items-center gap-2">
            <button
              className={`text-[11px] px-2 py-1 rounded ${dslTab === "view" ? "bg-foreground text-primary-foreground" : "bg-muted text-foreground"}`}
              onClick={() => setDslTab("view")}
            >
              {locale === "zh" ? "查看" : "View"}
            </button>
            <button
              className={`text-[11px] px-2 py-1 rounded ${dslTab === "explain" ? "bg-foreground text-primary-foreground" : "bg-muted text-foreground"}`}
              onClick={() => setDslTab("explain")}
            >
              {locale === "zh" ? "AI 解读" : "AI Explain"}
            </button>
            <button
              className={`text-[11px] px-2 py-1 rounded ${dslTab === "edit" ? "bg-foreground text-primary-foreground" : "bg-muted text-foreground"}`}
              onClick={() => setDslTab("edit")}
            >
              {locale === "zh" ? "编辑" : "Edit"}
            </button>
          </div>
        </div>
        <div className="p-3">
          {dslError && <div className="text-xs text-red-500">{dslError}</div>}
          {dslTab === "view" && (
            <pre className="text-[11px] leading-relaxed bg-muted/40 p-3 rounded-md overflow-auto max-h-[280px]">
              {dslText || (locale === "zh" ? "暂无 DSL" : "No DSL")}
            </pre>
          )}
          {dslTab === "explain" && (
            <div className="text-xs text-foreground space-y-2">
              {aiExplain.map((line, idx) => (
                <div key={idx} className="leading-relaxed">{line}</div>
              ))}
            </div>
          )}
          {dslTab === "edit" && (
            <div className="space-y-2">
              <textarea
                value={dslText}
                onChange={(e) => setDslText(e.target.value)}
                rows={10}
                className="w-full text-[11px] leading-relaxed border border-border rounded-md p-2 bg-background"
              />
              <div className="flex items-center gap-2">
                <button
                  className="text-[11px] px-3 py-1.5 rounded bg-foreground text-primary-foreground"
                  onClick={() => {
                    try {
                      const parsed = JSON.parse(dslText || "{}");
                      const payload = parsed.dsl ? parsed : { dsl: parsed };
                      onDslOverrideChange(payload);
                      toast.success(locale === "zh" ? "DSL 已应用到下一次回测" : "DSL override applied to next run");
                    } catch {
                      toast.error(locale === "zh" ? "DSL 解析失败" : "Invalid DSL JSON");
                    }
                  }}
                >
                  {locale === "zh" ? "应用到下一次回测" : "Apply to Next Run"}
                </button>
                <button
                  className="text-[11px] px-3 py-1.5 rounded bg-muted text-foreground"
                  onClick={() => {
                    onDslOverrideChange(null);
                    toast.message(locale === "zh" ? "已清除 DSL 覆盖" : "DSL override cleared");
                  }}
                >
                  {locale === "zh" ? "清除覆盖" : "Clear Override"}
                </button>
                {dslOverride && (
                  <span className="text-[11px] text-amber-600">
                    {locale === "zh" ? "已启用 DSL 覆盖" : "DSL override active"}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {divergences.length > 0 && (
        <DivergenceSection divergences={divergences} locale={locale} />
      )}

      {/* Trade Table */}
      <TradeTable
        trades={report?.trades || null}
        loading={isLoading && !report}
        selectedTrade={activeTrade}
        onTradeHover={(trade) => setHoveredTrade(trade)}
        onTradeSelect={(trade) => {
          setPinnedTrade((prev) => (getTradeKey(prev) === getTradeKey(trade) ? null : trade));
        }}
        onTableLeave={() => {
          setHoveredTrade(null);
          setPinnedTrade(null);
        }}
      />
    </div>
  );
}

function buildDslExplanation(dslContent: any, locale: "en" | "zh"): string[] {
  if (!dslContent || typeof dslContent !== "object") {
    return [locale === "zh" ? "没有可解读的 DSL。" : "No DSL to explain."];
  }
  const spec = dslContent.dsl ? dslContent : dslContent;
  const universe = spec.universe || {};
  const signal = universe.signal_symbol || universe.signal || "N/A";
  const trade = universe.trade_symbol || universe.trade || "N/A";
  const rules = spec.dsl?.logic?.rules || [];
  const events = spec.dsl?.signal?.events || [];
  const actions = spec.dsl?.action?.actions || [];

  const lines: string[] = [];
  lines.push(locale === "zh"
    ? `观察标的：${signal}；交易标的：${trade}`
    : `Signal symbol: ${signal}; Trade symbol: ${trade}`);
  lines.push(locale === "zh"
    ? `规则数量：${rules.length}，事件数量：${events.length}，动作数量：${actions.length}`
    : `Rules: ${rules.length}, Events: ${events.length}, Actions: ${actions.length}`);
  const stageRules = rules.map((r: any) => String(r.id || "rule"));
  if (stageRules.length > 0) {
    lines.push(locale === "zh"
      ? `规则列表：${stageRules.join(", ")}`
      : `Rule IDs: ${stageRules.join(", ")}`);
  }
  return lines;
}

function DivergenceSection({ divergences, locale }: { divergences: DivergenceSignal[]; locale: "en" | "zh" }) {
  const top = [...divergences]
    .sort((a, b) => (b.strengthScore ?? 0) - (a.strengthScore ?? 0))
    .slice(0, 20);

  return (
    <div className="border border-border rounded-lg bg-card overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border text-xs font-semibold text-foreground">
        {locale === "zh" ? "背离识别结果" : "Divergence Signals"}
      </div>
      <div className="max-h-[240px] overflow-y-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-card z-10">
            <tr className="border-b border-border/70">
              <th className="text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider py-2 px-3">{locale === "zh" ? "时间" : "Time"}</th>
              <th className="text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider py-2 px-3">{locale === "zh" ? "类型" : "Type"}</th>
              <th className="text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider py-2 px-3">{locale === "zh" ? "指标" : "Indicator"}</th>
              <th className="text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider py-2 px-3">{locale === "zh" ? "周期" : "TF"}</th>
              <th className="text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider py-2 px-3">{locale === "zh" ? "强度" : "Strength"}</th>
            </tr>
          </thead>
          <tbody>
            {top.map((d, idx) => (
              <tr key={`${d.eventId}-${d.triggerTime}-${idx}`} className="border-b border-border/30">
                <td className="py-2 px-3 text-xs text-foreground">{(d.triggerTime || "").slice(0, 10)}</td>
                <td className="py-2 px-3 text-xs">
                  <span className={d.direction === "bearish" ? "text-red-600" : "text-emerald-600"}>
                    {d.direction === "bearish" ? (locale === "zh" ? "顶背离" : "Bearish") : (locale === "zh" ? "底背离" : "Bullish")}
                  </span>
                </td>
                <td className="py-2 px-3 text-xs text-foreground">{d.indicator}</td>
                <td className="py-2 px-3 text-xs text-foreground">{String(d.timeframe).toUpperCase()}</td>
                <td className="py-2 px-3 text-xs text-foreground">{d.strengthScore?.toFixed(3) ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
