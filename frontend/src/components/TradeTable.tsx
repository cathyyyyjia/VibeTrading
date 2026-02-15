import { Download } from "lucide-react";
import { downloadCsv, tradesToCsv } from "@/lib/csv";
import { useI18n } from "@/contexts/I18nContext";
import { formatDateByLocale, isIsoDate } from "@/lib/date";
import type { TradeRecord } from "@/lib/api";

interface TradeTableProps {
  trades: TradeRecord[] | null;
  loading: boolean;
  runId: string | null;
}

function SkeletonRow() {
  return (
    <tr className="border-b border-border/40">
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <td key={i} className="py-3 px-4">
          <div className="h-3.5 bg-muted rounded animate-pulse" style={{ width: `${50 + i * 8}%` }} />
        </td>
      ))}
    </tr>
  );
}

export default function TradeTable({ trades, loading, runId }: TradeTableProps) {
  const { t, locale } = useI18n();

  const formatTradeDate = (value?: string): string => {
    if (!value) return "-";
    const justDate = value.slice(0, 10);
    if (!isIsoDate(justDate)) return value;
    return formatDateByLocale(justDate, locale);
  };

  const handleExportCSV = () => {
    if (!trades) return;
    const csv = tradesToCsv(trades as never);
    downloadCsv(`trades-${runId || "export"}.csv`, csv);
  };

  const headers = [
    t("trade.timestamp"),
    t("trade.symbol"),
    t("trade.action"),
    t("trade.price"),
    t("trade.pnl"),
    t("trade.pnlPct"),
    t("trade.reason"),
  ];

  if (loading) {
    return (
      <div className="border border-border rounded-lg bg-card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              {headers.map((h) => (
                <th key={h} className="text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider py-2.5 px-4">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[0, 1, 2].map((i) => (
              <SkeletonRow key={i} />
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const hasTrades = Array.isArray(trades) && trades.length > 0;

  return (
    <div className="border border-border rounded-lg bg-card overflow-hidden">
      <div className="flex items-center justify-end px-4 py-3 border-b border-border">
        <button onClick={handleExportCSV} className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
          <Download className="w-3.5 h-3.5" />
          {t("trade.exportCsv")}
        </button>
      </div>

      <div className="max-h-[300px] overflow-y-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-card z-10">
            <tr className="border-b border-border">
              {headers.map((h) => (
                <th key={h} className="text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider py-2.5 px-4">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hasTrades ? trades!.map((trade, index) => (
              <tr key={index} className={`hover:bg-muted/20 transition-colors ${index < trades.length - 1 ? "border-b border-border/40" : ""}`}>
                <td className="py-2.5 px-4 text-sm text-muted-foreground">{formatTradeDate(trade.entryTime || trade.timestamp)}</td>
                <td className="py-2.5 px-4 text-sm font-medium text-foreground font-mono">{trade.symbol}</td>
                <td className="py-2.5 px-4">
                  <span
                    className={`inline-block text-xs font-semibold px-2 py-0.5 rounded ${
                      trade.action === "BUY" ? "text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-950" : "text-red-700 bg-red-50 dark:text-red-400 dark:bg-red-950"
                    }`}
                  >
                    {trade.action}
                  </span>
                </td>
                <td className="py-2.5 px-4 text-sm font-mono text-foreground">
                  ${trade.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td className="py-2.5 px-4 text-sm font-mono">
                  {trade.pnl !== null && trade.pnl !== undefined ? (
                    <span className={trade.pnl >= 0 ? "text-emerald-600" : "text-red-500"}>
                      {trade.pnl >= 0 ? "+" : ""}${trade.pnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </td>
                <td className="py-2.5 px-4 text-sm font-mono">
                  {trade.pnlPct !== null && trade.pnlPct !== undefined ? (
                    <span className={trade.pnlPct >= 0 ? "text-emerald-600" : "text-red-500"}>
                      {trade.pnlPct >= 0 ? "+" : ""}
                      {trade.pnlPct.toFixed(2)}%
                    </span>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </td>
                <td className="py-2.5 px-4 text-xs text-muted-foreground max-w-[200px] truncate" title={trade.reason || ""}>
                  {trade.reason || "-"}
                </td>
              </tr>
            )) : (
              <tr className="border-b border-border/40">
                <td className="py-2.5 px-4 text-sm text-muted-foreground">-</td>
                <td className="py-2.5 px-4 text-sm text-muted-foreground">-</td>
                <td className="py-2.5 px-4 text-sm text-muted-foreground">-</td>
                <td className="py-2.5 px-4 text-sm text-muted-foreground">-</td>
                <td className="py-2.5 px-4 text-sm text-muted-foreground">-</td>
                <td className="py-2.5 px-4 text-sm text-muted-foreground">-</td>
                <td className="py-2.5 px-4 text-sm text-muted-foreground">-</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
