// ============================================================
// ArtifactsSection - Bottom artifacts in AI Workspace
// Design: Swiss Precision - minimal list, copy/download actions
// ============================================================

import { Copy, Download, FileText, FileSpreadsheet, Code2 } from 'lucide-react';
import { toast } from 'sonner';
import { useI18n } from '@/contexts/I18nContext';
import { getRunArtifact, type RunStatusResponse } from '@/lib/api';

interface ArtifactsSectionProps {
  runId: string;
  artifacts: RunStatusResponse['artifacts'];
}

export default function ArtifactsSection({ runId, artifacts }: ArtifactsSectionProps) {
  const { t } = useI18n();

  const handleCopyDsl = async () => {
    try {
      const a = await getRunArtifact(runId, 'dsl.json');
      const text = a?.content ? JSON.stringify(a.content, null, 2) : '';
      if (!text) {
        toast.info(t('artifact.comingSoon'), { description: t('artifact.copiedDesc') });
        return;
      }
      await navigator.clipboard.writeText(text);
      toast.success(t('artifact.copied'), { description: t('artifact.copiedDesc') });
    } catch {
      toast.error(t('artifact.copyFailed'));
    }
  };

  return (
    <div className="mt-4 border-t border-border pt-4">
      <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-3">
        {t('artifact.title')}
      </h4>
      <div className="space-y-0.5">
        {/* Strategy DSL - Copy */}
        <button
          onClick={handleCopyDsl}
          className="w-full flex items-center justify-between py-2.5 px-3 rounded-md hover:bg-muted/50 transition-colors group"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-muted flex items-center justify-center text-muted-foreground">
              <Code2 className="w-3.5 h-3.5" />
            </div>
            <span className="text-xs font-medium text-foreground">{t('artifact.strategyDsl')}</span>
          </div>
          <Copy className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        </button>

        {/* Backtest Report - Download */}
        <a
          href={artifacts.reportUrl || '#'}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => {
            if (!artifacts.reportUrl || artifacts.reportUrl === '#') {
              e.preventDefault();
              toast.info(t('artifact.comingSoon'), { description: t('artifact.reportComingSoonDesc') });
            }
          }}
          className="w-full flex items-center justify-between py-2.5 px-3 rounded-md hover:bg-muted/50 transition-colors group"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-muted flex items-center justify-center text-muted-foreground">
              <FileText className="w-3.5 h-3.5" />
            </div>
            <span className="text-xs font-medium text-foreground">{t('artifact.backtestReport')}</span>
          </div>
          <Download className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        </a>

        {/* Trades CSV - Download */}
        <a
          href={artifacts.tradesCsvUrl || '#'}
          download
          onClick={(e) => {
            if (!artifacts.tradesCsvUrl || artifacts.tradesCsvUrl === '#') {
              e.preventDefault();
              toast.info(t('artifact.comingSoon'), { description: t('artifact.csvComingSoonDesc') });
            }
          }}
          className="w-full flex items-center justify-between py-2.5 px-3 rounded-md hover:bg-muted/50 transition-colors group"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-muted flex items-center justify-center text-muted-foreground">
              <FileSpreadsheet className="w-3.5 h-3.5" />
            </div>
            <span className="text-xs font-medium text-foreground">{t('artifact.tradesCsv')}</span>
          </div>
          <Download className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        </a>
      </div>
    </div>
  );
}
