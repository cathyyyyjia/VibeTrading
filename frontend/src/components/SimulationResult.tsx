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
import { getRunArtifact, parseStrategy } from '@/lib/api';
import { toast } from 'sonner';
import { useMemo, useState, useEffect } from 'react';

interface SimulationResultProps {
  report: RunReportResponse | null;
  status: AppStatus;
  runId: string | null;
  artifacts: { dsl: string; reportUrl: string; tradesCsvUrl: string } | null;
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
  artifacts,
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
  const [strategyText, setStrategyText] = useState<string>("");
  const [aiBusy, setAiBusy] = useState(false);
  const isLoading = status === 'running' || status === 'analyzing';
  const showResult = status === 'analyzing' || status === 'running' || status === 'completed' || status === 'failed';
  const range = `${backtestStartDate} - ${backtestEndDate}`;
  const activeTrade = useMemo(() => hoveredTrade ?? pinnedTrade, [hoveredTrade, pinnedTrade]);
  const divergences = report?.divergences || [];
  const aiExplain = useMemo(() => buildDslReview(dslContent, strategyText, locale), [dslContent, strategyText, locale]);

  useEffect(() => {
    let cancelled = false;
    const loadDsl = async () => {
      if (!runId) return;
      if (!artifacts?.dsl) {
        if (status === "completed" || status === "failed") {
          setDslError(locale === "zh" ? "DSL 暂不可用" : "DSL not available");
        } else {
          setDslError(null);
        }
        return;
      }
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
  }, [runId, artifacts?.dsl, status, locale]);

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
              {locale === "zh" ? "AI 解析&修改" : "AI Parse & Edit"}
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
            <div className="text-xs text-foreground space-y-4">
              <div>
                <div className="font-semibold text-[11px] mb-1">{locale === "zh" ? "DSL 解读（结构化）" : "DSL Interpretation (Structured)"}</div>
                <ul className="list-disc pl-4 space-y-1">
                  {aiExplain.structure.map((line, idx) => (
                    <li key={`s-${idx}`} className="leading-relaxed">{line}</li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="font-semibold text-[11px] mb-1">{locale === "zh" ? "与“策略文字”的一致性检查" : "Consistency Check vs Strategy Text"}</div>
                <ul className="list-disc pl-4 space-y-1">
                  {aiExplain.consistency.map((line, idx) => (
                    <li key={`c-${idx}`} className="leading-relaxed">{line}</li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="font-semibold text-[11px] mb-1">{locale === "zh" ? "结论" : "Conclusion"}</div>
                <div className="leading-relaxed">{aiExplain.conclusion}</div>
              </div>
              <div className="pt-2 border-t border-border/60 space-y-2">
                <div className="font-semibold text-[11px]">{locale === "zh" ? "策略文字" : "Strategy Text"}</div>
                <textarea
                  value={strategyText}
                  onChange={(e) => setStrategyText(e.target.value)}
                  rows={4}
                  placeholder={locale === "zh" ? "粘贴你想对齐的策略文字（例如：观察QQQ...）" : "Paste the target strategy text to align with DSL"}
                  className="w-full text-[11px] leading-relaxed border border-border rounded-md p-2 bg-background"
                />
                <div className="flex items-center gap-2">
                  <button
                    className="text-[11px] px-3 py-1.5 rounded bg-foreground text-primary-foreground disabled:opacity-60"
                    disabled={aiBusy}
                    onClick={async () => {
                      if (!strategyText.trim()) {
                        toast.error(locale === "zh" ? "请先输入策略文字" : "Please provide strategy text");
                        return;
                      }
                      setAiBusy(true);
                      try {
                        const res = await parseStrategy(strategyText.trim(), "BACKTEST_ONLY");
                        const spec = res?.spec ?? null;
                        if (!spec) throw new Error("empty spec");
                        setDslContent(spec);
                        setDslText(JSON.stringify(spec, null, 2));
                        onDslOverrideChange(spec);
                        toast.success(locale === "zh" ? "已生成并应用一致 DSL" : "Aligned DSL generated and applied");
                      } catch (e) {
                        const msg = e instanceof Error ? e.message : "Failed to parse strategy";
                        toast.error(locale === "zh" ? `生成失败：${msg}` : `Generate failed: ${msg}`);
                      } finally {
                        setAiBusy(false);
                      }
                    }}
                  >
                    {aiBusy ? (locale === "zh" ? "生成中..." : "Generating...") : (locale === "zh" ? "用 Vibe Coding 修正 DSL" : "Vibe Coding: Align DSL")}
                  </button>
                  <span className="text-[11px] text-muted-foreground">
                    {locale === "zh" ? "将使用后端解析生成新 DSL，并应用到下一次回测" : "Uses backend parsing to generate a new DSL and applies it to the next run"}
                  </span>
                </div>
              </div>
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

function buildDslReview(dslContent: any, strategyText: string, locale: "en" | "zh"): { structure: string[]; consistency: string[]; conclusion: string } {
  if (!dslContent || typeof dslContent !== "object") {
    return {
      structure: [locale === "zh" ? "没有可解读的 DSL。" : "No DSL to explain."],
      consistency: [locale === "zh" ? "未提供 DSL，无法做一致性检查。" : "No DSL provided; consistency check unavailable."],
      conclusion: locale === "zh" ? "请先生成并加载 DSL。" : "Please generate and load a DSL first.",
    };
  }

  const spec = dslContent.dsl ? dslContent : dslContent;
  const universe = spec.universe || {};
  const signal = universe.signal_symbol || universe.signal || "N/A";
  const trade = universe.trade_symbol || universe.trade || "N/A";
  const rules = spec.dsl?.logic?.rules || [];
  const events = spec.dsl?.signal?.events || [];
  const actions = spec.dsl?.action?.actions || [];
  const indicators = spec.dsl?.signal?.indicators || [];
  const tfs = Array.from(new Set(indicators.map((i: any) => i?.tf).filter(Boolean)));

  const structure: string[] = [];
  structure.push(locale === "zh"
    ? `观察标的：${signal}；交易标的：${trade}`
    : `Signal symbol: ${signal}; Trade symbol: ${trade}`);
  if (tfs.length > 0) {
    structure.push(locale === "zh"
      ? `指标周期：${tfs.join(", ")}`
      : `Indicator timeframes: ${tfs.join(", ")}`);
  }
  structure.push(locale === "zh"
    ? `规则数量：${rules.length}，事件数量：${events.length}，动作数量：${actions.length}`
    : `Rules: ${rules.length}, Events: ${events.length}, Actions: ${actions.length}`);
  const stageRules = rules.map((r: any) => String(r.id || "rule"));
  if (stageRules.length > 0) {
    structure.push(locale === "zh"
      ? `规则列表：${stageRules.join(", ")}`
      : `Rule IDs: ${stageRules.join(", ")}`);
  }
  const actionFractions = actions
    .map((a: any) => a?.qty?.mode === "FRACTION_OF_EQUITY" ? Number(a.qty.value) : null)
    .filter((v: any) => typeof v === "number");
  if (actionFractions.length > 0) {
    const pct = actionFractions.map((v: number) => `${Math.round(v * 100)}%`).join(", ");
    structure.push(locale === "zh" ? `分段仓位：${pct}` : `Stage sizes: ${pct}`);
  }

  const consistency: string[] = [];
  const text = (strategyText || "").trim();
  if (!text) {
    consistency.push(locale === "zh" ? "未提供策略文字，无法检查一致性。" : "Strategy text not provided.");
    return {
      structure,
      consistency,
      conclusion: locale === "zh" ? "请补充策略文字后再检查一致性。" : "Provide strategy text for consistency check.",
    };
  }

  const textLower = text.toLowerCase();
  const mentionedIndicators = new Set<string>();
  if (textLower.includes("kdj")) mentionedIndicators.add("KDJ");
  if (textLower.includes("macd")) mentionedIndicators.add("MACD");
  if (textLower.includes("rsi")) mentionedIndicators.add("RSI");
  if (textLower.includes("boll") || text.includes("布林")) mentionedIndicators.add("BOLL");
  if (textLower.includes("bias") || text.includes("乖离")) mentionedIndicators.add("BIAS");
  if (/\bma\d+\b/i.test(textLower) || text.includes("均线") || text.includes("MA")) mentionedIndicators.add("MA");

  const dslIndicators = new Set(indicators.map((i: any) => String(i?.type || "")));
  for (const ind of mentionedIndicators) {
    if (!dslIndicators.has(ind)) {
      consistency.push(locale === "zh" ? `文字提到 ${ind}，DSL 中未找到对应指标。` : `Text mentions ${ind}, but DSL lacks it.`);
    }
  }

  const tfMentioned =
    text.includes("周线") || text.includes("周级") || textLower.includes("weekly") ? "1w" :
    text.includes("日线") || text.includes("日级") || textLower.includes("daily") ? "1d" :
    text.includes("4小时") || textLower.includes("4h") || text.includes("小时") ? "4h" :
    text.includes("分钟") || textLower.includes("min") ? "1m" : null;
  if (tfMentioned && tfs.length > 0 && !tfs.includes(tfMentioned)) {
    consistency.push(locale === "zh"
      ? `文字周期为 ${tfMentioned}，DSL 指标周期为 ${tfs.join(", ")}。`
      : `Text timeframe ${tfMentioned} but DSL uses ${tfs.join(", ")}.`);
  }

  const textSymbols = new Set((text.match(/\b[A-Z]{2,6}\b/g) || []));
  if (textSymbols.size > 0) {
    if (textSymbols.has("QQQ") && signal !== "QQQ") {
      consistency.push(locale === "zh" ? "文字提到观察 QQQ，但 DSL 观察标的不是 QQQ。" : "Text mentions QQQ as signal, but DSL signal differs.");
    }
    if (textSymbols.has("TQQQ") && trade !== "TQQQ") {
      consistency.push(locale === "zh" ? "文字提到交易 TQQQ，但 DSL 交易标的不是 TQQQ。" : "Text mentions TQQQ as trade, but DSL trade differs.");
    }
  }

  const pctMatches = Array.from(text.matchAll(/(\d+)\s*%/g)).map((m) => Number(m[1]));
  if (pctMatches.length > 0 && actionFractions.length > 0) {
    const dslPct = actionFractions.map((v: number) => Math.round(v * 100)).sort((a, b) => a - b);
    const textPct = [...pctMatches].sort((a, b) => a - b);
    if (dslPct.join(",") !== textPct.join(",")) {
      consistency.push(locale === "zh"
        ? `文字分仓为 ${textPct.join(", ")}%，DSL 分仓为 ${dslPct.join(", ")}%。`
        : `Text stages ${textPct.join(", ")}%, DSL stages ${dslPct.join(", ")}%.`);
    }
  }

  const hasLookback = rules.some((r: any) => JSON.stringify(r?.when || {}).includes("event_within"));
  const textHasLookback = /过去|最近|近|within|last/i.test(text);
  if (hasLookback && !textHasLookback) {
    consistency.push(locale === "zh" ? "DSL 使用了“最近/过去 N 天”条件，但文字未明确说明。" : "DSL uses lookback windows, but text does not mention them.");
  }

  if (consistency.length === 0) {
    consistency.push(locale === "zh" ? "未发现明显不一致。" : "No obvious inconsistencies found.");
  }

  const conclusion = consistency.some((l) => l.includes("未找到") || l.includes("不") || l.includes("but"))
    ? (locale === "zh" ? "结论：当前 DSL 与策略文字不完全一致，建议使用下方按钮对齐。" : "Conclusion: DSL is not fully consistent with the text; consider aligning.")
    : (locale === "zh" ? "结论：当前 DSL 与策略文字基本一致。" : "Conclusion: DSL is broadly consistent with the text.");

  return { structure, consistency, conclusion };
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

