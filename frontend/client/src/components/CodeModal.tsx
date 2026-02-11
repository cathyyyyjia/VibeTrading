// ============================================================
// CodeModal - Full strategy code viewer modal
// Design: Swiss Precision - dark code block, clean modal
// ============================================================

import { X, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '@/contexts/I18nContext';

interface CodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  code: string;
}

export default function CodeModal({ isOpen, onClose, code }: CodeModalProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-background rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col border border-border">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">{t('code.title')}</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground bg-muted hover:bg-muted/80 rounded-md transition-colors"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                  {t('code.copied')}
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  {t('code.copy')}
                </>
              )}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-md hover:bg-muted transition-colors"
            >
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* Code */}
        <div className="flex-1 overflow-y-auto p-5">
          <div className="code-block p-4 overflow-x-auto">
            <pre className="text-xs leading-relaxed">
              <code>{code}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
