// ============================================================
// CSV Export Utility
// ============================================================

export function downloadCsv(filename: string, csvContent: string) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function tradesToCsv(trades: Array<{
  timestamp: string;
  symbol: string;
  action: string;
  price: number;
  pnl: number | null;
}>): string {
  const header = 'Timestamp,Symbol,Action,Price,P/L';
  const rows = trades.map(t =>
    `${t.timestamp},${t.symbol},${t.action},${t.price},${t.pnl ?? ''}`
  );
  return [header, ...rows].join('\n');
}
