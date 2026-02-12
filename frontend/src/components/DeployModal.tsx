// ============================================================
// DeployModal - Deployment confirmation modal
// Design: Swiss Precision - clean modal, paper/live options, toast
// ============================================================

import { useState } from 'react';
import { X, Rocket, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { useI18n } from '@/contexts/I18nContext';
import type { RunReportResponse, DeployResponse } from '@/lib/api';

interface DeployModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (mode: 'paper' | 'live') => Promise<DeployResponse>;
  report: RunReportResponse | null;
}

export default function DeployModal({ isOpen, onClose, onConfirm, report }: DeployModalProps) {
  const { t } = useI18n();
  const [mode, setMode] = useState<'paper' | 'live'>('paper');
  const [deploying, setDeploying] = useState(false);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    setDeploying(true);
    try {
      const result = await onConfirm(mode);
      toast.success(t('deploy.success'), {
        description: `Deploy ID: ${result.deployId} — Mode: ${mode.toUpperCase()}`,
      });
      onClose();
    } catch (e) {
      toast.error(t('deploy.failed'), {
        description: e instanceof Error ? e.message : t('deploy.tryAgain'),
      });
    } finally {
      setDeploying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-background rounded-xl shadow-xl w-full max-w-md mx-4 border border-border">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Rocket className="w-4 h-4 text-foreground" />
            <h3 className="text-sm font-semibold text-foreground">{t('deploy.title')}</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-muted transition-colors">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* KPI Summary */}
          {report && (
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-muted/30 rounded-lg p-3">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('sim.return')}</div>
                <div className="text-lg font-bold font-mono text-emerald-600">+{report.kpis.returnPct}%</div>
              </div>
              <div className="bg-muted/30 rounded-lg p-3">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('sim.sharpe')}</div>
                <div className="text-lg font-bold font-mono text-foreground">{report.kpis.sharpe}</div>
              </div>
            </div>
          )}

          {/* Mode Selection */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {t('deploy.mode')}
            </label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                onClick={() => setMode('paper')}
                className={`p-3 rounded-lg border text-left transition-all ${
                  mode === 'paper'
                    ? 'border-foreground bg-foreground/5 ring-1 ring-foreground/10'
                    : 'border-border hover:border-foreground/30'
                }`}
              >
                <div className="text-sm font-medium text-foreground">{t('deploy.paper')}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">{t('deploy.paperDesc')}</div>
              </button>
              <button
                onClick={() => setMode('live')}
                className={`p-3 rounded-lg border text-left transition-all ${
                  mode === 'live'
                    ? 'border-foreground bg-foreground/5 ring-1 ring-foreground/10'
                    : 'border-border hover:border-foreground/30'
                }`}
              >
                <div className="text-sm font-medium text-foreground">{t('deploy.live')}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">{t('deploy.liveDesc')}</div>
              </button>
            </div>
          </div>

          {/* Live Warning */}
          {mode === 'live' && (
            <div className="flex items-start gap-2.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-medium text-amber-800 dark:text-amber-300">{t('deploy.liveWarningTitle')}</div>
                <div className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5">
                  {t('deploy.liveWarningDesc')}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 px-5 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-foreground bg-background border border-border rounded-lg hover:bg-muted/50 transition-colors"
          >
            {t('deploy.cancel')}
          </button>
          <button
            onClick={handleConfirm}
            disabled={deploying}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-primary-foreground bg-foreground rounded-lg hover:bg-foreground/90 transition-colors disabled:opacity-60 shadow-sm"
          >
            {deploying ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                {t('deploy.deploying')}
              </>
            ) : (
              <>
                <Rocket className="w-3.5 h-3.5" />
                {t('deploy.deployTo')} {mode === 'paper' ? 'Paper' : 'Live'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
