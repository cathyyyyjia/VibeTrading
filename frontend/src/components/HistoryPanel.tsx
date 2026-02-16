// ============================================================
// HistoryPanel - Historical backtest records
// Uses tRPC for data fetching with REST API fallback
// ============================================================

import { useEffect, useState } from 'react';
import { ChevronDown, Download, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useI18n } from '@/contexts/I18nContext';
import { useAuth } from '@/contexts/AuthContext';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import * as api from '@/lib/api';
import type { HistoryEntry } from '@/lib/api';
import KPICards from './KPICards';
import EquityChart from './EquityChart';
import TradeTable from './TradeTable';

interface HistoryPanelProps {}

type RunMeta = {
  maWindowDays: number | null;
  macdFast: number | null;
  macdSlow: number | null;
  macdSignal: number | null;
  startDate: string | null;
  endDate: string | null;
};

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function HistoryPanel({}: HistoryPanelProps) {
  const { t, locale } = useI18n();
  const { session } = useAuth();
  const [isOpen, setIsOpen] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [detailsByRunId, setDetailsByRunId] = useState<Record<string, Partial<HistoryEntry>>>({});
  const [metaByRunId, setMetaByRunId] = useState<Record<string, RunMeta>>({});
  const [pendingDeleteEntry, setPendingDeleteEntry] = useState<HistoryEntry | null>(null);
  const [isDeletingStrategy, setIsDeletingStrategy] = useState(false);

  const parseRunMeta = (dslContent: any, requestContent: any): RunMeta => {
    const empty: RunMeta = {
      maWindowDays: null,
      macdFast: null,
      macdSlow: null,
      macdSignal: null,
      startDate: null,
      endDate: null,
    };
    const spec = dslContent && typeof dslContent === "object" ? dslContent : null;
    const indicators = Array.isArray(spec?.dsl?.signal?.indicators) ? spec.dsl.signal.indicators : [];
    const prefs = spec?.meta?.indicator_preferences && typeof spec.meta.indicator_preferences === "object"
      ? spec.meta.indicator_preferences
      : null;

    let ma: number | null = null;
    let mf: number | null = null;
    let ms: number | null = null;
    let msg: number | null = null;

    for (const ind of indicators) {
      if (!ind || typeof ind !== "object") continue;
      const type = String((ind as any).type || "").toUpperCase();
      const params = (ind as any).params && typeof (ind as any).params === "object" ? (ind as any).params : {};
      if (ma === null && (type === "MA" || type === "SMA")) {
        const raw = String(params.window || "").toLowerCase().replace("d", "");
        const parsed = Number(raw);
        if (Number.isFinite(parsed) && parsed > 0) ma = Math.floor(parsed);
      }
      if (mf === null && type === "MACD") {
        const f = Number(params.fast);
        const s = Number(params.slow);
        const sg = Number(params.signal);
        if (Number.isFinite(f) && f > 0) mf = Math.floor(f);
        if (Number.isFinite(s) && s > 0) ms = Math.floor(s);
        if (Number.isFinite(sg) && sg > 0) msg = Math.floor(sg);
      }
    }

    if (prefs && ma === null) {
      const raw = Number((prefs as any).maWindowDays ?? (prefs as any).ma_window_days);
      if (Number.isFinite(raw) && raw > 0) ma = Math.floor(raw);
    }
    if (prefs && mf === null) {
      const raw = Number((prefs as any).macdFast ?? (prefs as any).macd_fast ?? (prefs as any).macd?.fast);
      if (Number.isFinite(raw) && raw > 0) mf = Math.floor(raw);
    }
    if (prefs && ms === null) {
      const raw = Number((prefs as any).macdSlow ?? (prefs as any).macd_slow ?? (prefs as any).macd?.slow);
      if (Number.isFinite(raw) && raw > 0) ms = Math.floor(raw);
    }
    if (prefs && msg === null) {
      const raw = Number((prefs as any).macdSignal ?? (prefs as any).macd_signal ?? (prefs as any).macd?.signal);
      if (Number.isFinite(raw) && raw > 0) msg = Math.floor(raw);
    }

    const startDate =
      requestContent && typeof requestContent.start_date === "string" ? requestContent.start_date.slice(0, 10) : null;
    const endDate =
      requestContent && typeof requestContent.end_date === "string" ? requestContent.end_date.slice(0, 10) : null;

    return {
      ...empty,
      maWindowDays: ma,
      macdFast: mf,
      macdSlow: ms,
      macdSignal: msg,
      startDate,
      endDate,
    };
  };

  useEffect(() => {
    let cancelled = false;
    if (!session?.access_token) {
      setHistory([]);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    (async () => {
      setLoading(true);
      api
        .getHistory()
        .then((res) => {
          if (cancelled) return;
          setHistory(res.history);
        })
        .catch(() => {
          if (cancelled) return;
          setHistory([]);
        })
        .finally(() => {
          if (cancelled) return;
          setLoading(false);
        });
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.access_token]);

  const toggleExpanded = (runId: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(runId)) {
        next.delete(runId);
      } else {
        next.add(runId);
      }
      return next;
    });
  };

  useEffect(() => {
    const runIds = Array.from(expandedIds);
    for (const runId of runIds) {
      const existing = detailsByRunId[runId];
      if (existing?.equity || existing?.trades) continue;
      Promise.allSettled([
        api.getRunReport(runId),
        api.getRunArtifact(runId, "dsl.json"),
        api.getRunArtifact(runId, "request.json"),
      ]).then((result) => {
        const reportRes = result[0];
        const dslRes = result[1];
        const reqRes = result[2];
        if (reportRes.status === "fulfilled") {
          const rep = reportRes.value;
          setDetailsByRunId((prev) => ({ ...prev, [runId]: { ...(prev[runId] ?? {}), ...rep } }));
        }
        const dslContent = dslRes.status === "fulfilled" ? dslRes.value?.content : null;
        const reqContent = reqRes.status === "fulfilled" ? reqRes.value?.content : null;
        const meta = parseRunMeta(dslContent, reqContent);
        setMetaByRunId((prev) => ({ ...prev, [runId]: meta }));
      }).catch(() => {});
    }
  }, [expandedIds, detailsByRunId]);

  const handleDownloadArtifact = async (runId: string, name: string) => {
    try {
      const blob = await api.downloadRunArtifact(runId, name);
      triggerDownload(blob, `${runId}-${name}`);
    } catch {
      toast.error(t('history.downloadFailed'));
    }
  };

  const handleDeleteStrategy = async (entry: HistoryEntry) => {
    if (!entry.strategyId) {
      toast.error(t('history.deleteFailed'));
      return;
    }

    setIsDeletingStrategy(true);
    try {
      await api.deleteStrategy(entry.strategyId);
      const removedRunIds = new Set(history.filter((item) => item.strategyId === entry.strategyId).map((item) => item.runId));
      setHistory((prev) => prev.filter((item) => item.strategyId !== entry.strategyId));
      setDetailsByRunId((prev) => {
        const next = { ...prev };
        for (const runId of Object.keys(next)) {
          if (removedRunIds.has(runId)) delete next[runId];
        }
        return next;
      });
      setExpandedIds((prev) => {
        const next = new Set(prev);
        removedRunIds.forEach((runId) => next.delete(runId));
        return next;
      });
      toast.success(t('history.deleteSuccess'));
    } catch {
      toast.error(t('history.deleteFailed'));
    } finally {
      setIsDeletingStrategy(false);
      setPendingDeleteEntry(null);
    }
  };

  if (loading) {
    return (
      <div className="border-t border-border pt-8 mt-8">
        <div className="h-4 w-32 bg-muted rounded animate-pulse" />
      </div>
    );
  }

  if (history.length === 0) {
    return null;
  }

  return (
    <div className="border-t border-border pt-8 mt-8">
      {/* Header */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 mb-4 hover:text-foreground/80 transition-colors"
      >
        <ChevronDown
          className={`w-4 h-4 transition-transform ${isOpen ? '' : '-rotate-90'}`}
        />
        <h2 className="text-sm font-semibold text-foreground">{t('history.title')}</h2>
        <span className="text-xs text-muted-foreground ml-auto">{history.length} {t('history.runs')}</span>
      </button>

      {/* Items */}
      {isOpen && (
        <div className="space-y-3">
          {history.map((entry) => {
            const isExpanded = expandedIds.has(entry.runId);
            const details = detailsByRunId[entry.runId] ?? {};
            const runMeta = metaByRunId[entry.runId];
            const merged: HistoryEntry = { ...entry, ...details } as HistoryEntry;

            return (
              <div
                key={entry.runId}
                className="border border-border rounded-lg bg-card overflow-hidden"
              >
                {/* Item Header */}
                <button
                  onClick={() => toggleExpanded(entry.runId)}
                  className="w-full px-4 py-3 flex items-start gap-3 hover:bg-muted/30 transition-colors text-left"
                >
                  <ChevronDown
                    className={`w-4 h-4 mt-0.5 flex-shrink-0 transition-transform ${
                      isExpanded ? '' : '-rotate-90'
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground line-clamp-2">
                      {entry.prompt}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span
                        className={`inline-block text-xs font-semibold px-2 py-0.5 rounded ${
                          entry.state === 'completed'
                            ? 'text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-950'
                            : 'text-red-700 bg-red-50 dark:text-red-400 dark:bg-red-950'
                        }`}
                      >
                        {entry.state === 'completed' ? t('history.completed') : t('history.failed')}
                      </span>
                      {entry.kpis && (
                        <span className="text-xs text-muted-foreground">
                          {t('sim.return')}: {entry.kpis.returnPct >= 0 ? '+' : ''}{entry.kpis.returnPct}%
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (!entry.strategyId) {
                        toast.error(t('history.deleteFailed'));
                        return;
                      }
                      setPendingDeleteEntry(entry);
                    }}
                    className="p-1.5 rounded text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                    title={t('history.delete')}
                    aria-label={t('history.delete')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </button>

                {/* Expanded Content */}
                {isExpanded && (
                  <div className="border-t border-border px-4 py-4 space-y-4 bg-muted/5">
                    <div className="border border-border rounded-lg bg-card p-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                        <div className="text-muted-foreground">
                          MA/MACD: <span className="text-foreground">
                            {runMeta?.maWindowDays ? `MA${runMeta.maWindowDays}` : "MA-"}
                            {", "}
                            {runMeta?.macdFast && runMeta?.macdSlow && runMeta?.macdSignal
                              ? `MACD ${runMeta.macdFast}/${runMeta.macdSlow}/${runMeta.macdSignal}`
                              : "MACD -/-/-"}
                          </span>
                        </div>
                        <div className="text-muted-foreground">
                          {locale === "zh" ? "回测时间" : "Backtest Window"}: <span className="text-foreground">
                            {runMeta?.startDate && runMeta?.endDate ? `${runMeta.startDate} - ${runMeta.endDate}` : "-"}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* KPI Cards */}
                    {merged.kpis && (
                      <div>
                        <h3 className="text-xs font-semibold text-muted-foreground uppercase mb-3">
                          {t('history.performanceMetrics')}
                        </h3>
                        <KPICards kpis={merged.kpis} loading={false} />
                      </div>
                    )}

                    {/* Equity Chart */}
                    {merged.equity && (
                      <div>
                        <h3 className="text-xs font-semibold text-muted-foreground uppercase mb-3">
                          {t('history.equityCurve')}
                        </h3>
                        <EquityChart
                          data={merged.equity}
                          trades={merged.trades || null}
                          loading={false}
                        />
                      </div>
                    )}

                    {/* Trade Table */}
                    {merged.trades && (
                      <div>
                        <h3 className="text-xs font-semibold text-muted-foreground uppercase mb-3">
                          {t('history.trades')}
                        </h3>
                        <TradeTable trades={merged.trades} loading={false} />
                      </div>
                    )}

                    {/* Download Section */}
                    <div className="border-t border-border pt-4">
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                        {t('history.downloadResults')}
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => void handleDownloadArtifact(entry.runId, "dsl.json")}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-border rounded-md text-foreground hover:bg-muted/30 transition-colors"
                        >
                          <Download className="w-3.5 h-3.5" />
                          DSL JSON
                        </button>
                        <button
                          onClick={() => void handleDownloadArtifact(entry.runId, "report.json")}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-border rounded-md text-foreground hover:bg-muted/30 transition-colors"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Report JSON
                        </button>
                        <button
                          onClick={() => void handleDownloadArtifact(entry.runId, "trades.csv")}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-border rounded-md text-foreground hover:bg-muted/30 transition-colors"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Trades CSV
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <AlertDialog
        open={pendingDeleteEntry !== null}
        onOpenChange={(open) => {
          if (!open && !isDeletingStrategy) {
            setPendingDeleteEntry(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('history.delete')}</AlertDialogTitle>
            <AlertDialogDescription>{t('history.deleteConfirm')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingStrategy}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeletingStrategy || !pendingDeleteEntry}
              onClick={(event) => {
                event.preventDefault();
                if (!pendingDeleteEntry || isDeletingStrategy) return;
                void handleDeleteStrategy(pendingDeleteEntry);
              }}
            >
              {t('history.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
