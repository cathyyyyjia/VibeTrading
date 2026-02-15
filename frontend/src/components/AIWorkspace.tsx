// ============================================================
// AIWorkspace - Right column: step cards + artifacts
// Design: Swiss Precision - timeline flow, status tracking
// ============================================================

import { Sparkles } from 'lucide-react';
import WorkspaceStepCard from './WorkspaceStep';
import ArtifactsSection from './ArtifactsSection';
import { useI18n } from '@/contexts/I18nContext';
import type { AppStatus } from '@/hooks/useBacktest';
import type { StepInfo, RunStatusResponse } from '@/lib/api';

interface AIWorkspaceProps {
  status: AppStatus;
  runId: string | null;
  steps: StepInfo[];
  progress: number;
  artifacts: RunStatusResponse['artifacts'] | null;
}

export default function AIWorkspace({ status, runId, steps, progress, artifacts }: AIWorkspaceProps) {
  const { t } = useI18n();

  const isIdle = status === 'idle';

  return (
    <div className="h-full flex flex-col bg-muted/30">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border shrink-0 bg-background">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">{t('workspace.title')}</h2>
          </div>
        </div>
        {!isIdle && (
          <p className="text-xs text-muted-foreground mt-1.5">
            {t('workspace.subtitle')}
          </p>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {isIdle ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-6">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
              <Sparkles className="w-5 h-5 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-medium text-foreground mb-1.5">{t('workspace.readyTitle')}</h3>
            <p className="text-xs text-muted-foreground leading-relaxed max-w-[240px]">
              {t('workspace.readySubtitle')}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {steps.map((step, index) => (
              <WorkspaceStepCard
                key={step.key}
                step={step}
                isLast={index === steps.length - 1}
                progress={progress}
              />
            ))}

            {/* Artifacts */}
            {status === 'completed' && artifacts && runId && (
              <ArtifactsSection runId={runId} artifacts={artifacts} />
            )}
          </div>
        )}
      </div>

    </div>
  );
}
