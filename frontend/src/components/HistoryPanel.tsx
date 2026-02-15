// ============================================================
// HistoryPanel - Historical backtest records
// Uses tRPC for data fetching with REST API fallback
// ============================================================

import { useEffect, useState } from 'react';
import { ChevronDown, Copy, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useI18n } from '@/contexts/I18nContext';
import { useAuth } from '@/contexts/AuthContext';
import * as api from '@/lib/api';
import type { HistoryEntry } from '@/lib/api';
import KPICards from './KPICards';
import EquityChart from './EquityChart';
import TradeTable from './TradeTable';

interface HistoryPanelProps {
  onSelectPrompt?: (prompt: string) => void;
}

export default function HistoryPanel({ onSelectPrompt }: HistoryPanelProps) {
  const { t } = useI18n();
  const { session } = useAuth();
  const [isOpen, setIsOpen] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [detailsByRunId, setDetailsByRunId] = useState<Record<string, Partial<HistoryEntry>>>({});

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
      if (existing?.equity || existing?.trades || existing?.dsl) continue;
      api
        .getRunReport(runId)
        .then((rep) => {
          setDetailsByRunId((prev) => ({ ...prev, [runId]: { ...(prev[runId] ?? {}), ...rep } }));
        })
        .catch(() => {});
      api
        .getRunArtifact(runId, "dsl.json")
        .then((a) => {
          const dsl = a?.content ? JSON.stringify(a.content, null, 2) : "";
          setDetailsByRunId((prev) => ({ ...prev, [runId]: { ...(prev[runId] ?? {}), dsl } }));
        })
        .catch(() => {});
    }
  }, [expandedIds, detailsByRunId]);

  const handleCopyDsl = (dsl: string) => {
    navigator.clipboard.writeText(dsl);
    toast.success(t('history.dslCopied'));
  };

  const handleLoadPrompt = (prompt: string) => {
    if (onSelectPrompt) {
      onSelectPrompt(prompt);
      toast.success(t('history.promptLoaded'));
    }
  };

  const handleDeleteStrategy = async (entry: HistoryEntry) => {
    if (!entry.strategyId) {
      toast.error(t('history.deleteFailed'));
      return;
    }
    if (!window.confirm(t('history.deleteConfirm'))) return;
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
    }
  };

  if (loading) {
    return (
      <div className="border-t border-border pt-6">
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
                          {t('sim.return')}: +{entry.kpis.returnPct}%
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleDeleteStrategy(entry);
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
                        <EquityChart data={merged.equity} loading={false} />
                      </div>
                    )}

                    {/* Trade Table */}
                    {merged.trades && (
                      <div>
                        <h3 className="text-xs font-semibold text-muted-foreground uppercase mb-3">
                          {t('history.trades')}
                        </h3>
                        <TradeTable trades={merged.trades} loading={false} runId={entry.runId} />
                      </div>
                    )}

                    {/* DSL Section */}
                    <div className="border-t border-border pt-4">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-xs font-semibold text-muted-foreground uppercase">
                          {t('history.strategyDsl')}
                        </h3>
                        <button
                          onClick={() => handleCopyDsl(merged.dsl)}
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <Copy className="w-3 h-3" />
                          {t('history.copy')}
                        </button>
                      </div>
                      <div className="bg-foreground text-primary-foreground rounded p-3 text-xs font-mono overflow-x-auto max-h-[120px] overflow-y-auto">
                        <pre className="whitespace-pre-wrap break-words text-[10px]">
                          {merged.dsl ? `${merged.dsl.substring(0, 300)}...` : t('history.loadingReport')}
                        </pre>
                      </div>
                    </div>

                    {/* Load Prompt Button */}
                    <button
                      onClick={() => handleLoadPrompt(entry.prompt)}
                      className="w-full px-3 py-2 text-xs font-medium text-foreground border border-border rounded hover:bg-muted/30 transition-colors"
                    >
                      {t('history.loadStrategy')}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
