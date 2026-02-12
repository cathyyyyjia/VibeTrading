// ============================================================
// ErrorCard - Error display with retry button
// Design: Swiss Precision - red accent, clean error message
// ============================================================

import { AlertTriangle, RotateCcw } from 'lucide-react';
import { useI18n } from '@/contexts/I18nContext';

interface ErrorCardProps {
  message: string;
  onRetry: () => void;
}

export default function ErrorCard({ message, onRetry }: ErrorCardProps) {
  const { t } = useI18n();

  return (
    <div className="border border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/30 rounded-lg p-4 mt-6">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-red-100 dark:bg-red-900 flex items-center justify-center shrink-0 mt-0.5">
          <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400" />
        </div>
        <div className="flex-1">
          <h4 className="text-sm font-semibold text-red-900 dark:text-red-300 mb-1">{t('error.backtestFailed')}</h4>
          <p className="text-xs text-red-700/80 dark:text-red-400/80 mb-3">{message}</p>
          <button
            onClick={onRetry}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900 hover:bg-red-200 dark:hover:bg-red-800 rounded-md transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            {t('error.retryBacktest')}
          </button>
        </div>
      </div>
    </div>
  );
}
