// ============================================================
// BottomBar - Bottom action bar (positioned within left column)
// Design: Swiss Precision - status text + Revise/Deploy buttons
// ============================================================

import { Rocket } from 'lucide-react';
import { useI18n } from '@/contexts/I18nContext';
import type { AppStatus } from '@/hooks/useBacktest';

interface BottomBarProps {
  status: AppStatus;
  statusMessage: string;
  onRevise: () => void;
  onDeploy: () => void;
}

export default function BottomBar({ status, statusMessage, onRevise, onDeploy }: BottomBarProps) {
  const { t } = useI18n();
  const showActions = status === 'analyzing' || status === 'running' || status === 'completed';
  const isIdle = status === 'idle';

  if (isIdle) return null;

  return (
    <div className="shrink-0 bg-background border-t border-border">
      <div className="flex items-center justify-between px-6 py-3">
        {/* Status */}
        <div className="flex items-center gap-2">
          {(status === 'running' || status === 'analyzing') && (
            <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
          )}
          {status === 'completed' && (
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          )}
          {status === 'failed' && (
            <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
          )}
          <span className="text-xs text-muted-foreground">{statusMessage}</span>
        </div>

        {/* Actions */}
        {showActions && (
          <div className="flex items-center gap-2.5">
            <button
              onClick={onRevise}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-foreground bg-background border border-border rounded-lg hover:bg-muted/50 transition-colors"
            >
              {t('action.revisePrompt')}
            </button>
            <button
              onClick={onDeploy}
              disabled={status !== 'completed'}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-primary-foreground bg-foreground rounded-lg hover:bg-foreground/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
            >
              {t('action.confirmDeploy')}
              <Rocket className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
