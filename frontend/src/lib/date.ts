import type { Locale } from "@/contexts/I18nContext";

export type BacktestWindowPreset = "all" | "1m" | "3m" | "6m" | "1y" | "custom";

export interface BacktestDateRange {
  startDate: string;
  endDate: string;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

export function parseIsoDate(value: string): Date | null {
  if (!isIsoDate(value)) return null;
  const [y, m, d] = value.split("-").map((part) => Number(part));
  const candidate = new Date(y, m - 1, d);
  if (candidate.getFullYear() !== y || candidate.getMonth() !== m - 1 || candidate.getDate() !== d) return null;
  return candidate;
}

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function shiftByMonths(date: Date, months: number): Date {
  const next = new Date(date.getFullYear(), date.getMonth() + months, date.getDate());
  if (next.getMonth() === ((date.getMonth() + months) % 12 + 12) % 12) return next;
  return new Date(next.getFullYear(), next.getMonth() + 1, 0);
}

export function getPresetDateRange(preset: Exclude<BacktestWindowPreset, "custom">, baseDate: Date = new Date()): BacktestDateRange {
  const end = new Date(baseDate);
  let start = new Date(baseDate);
  if (preset === "all") start = new Date(2023, 0, 1);
  if (preset === "1m") start = shiftByMonths(baseDate, -1);
  if (preset === "3m") start = shiftByMonths(baseDate, -3);
  if (preset === "6m") start = shiftByMonths(baseDate, -6);
  if (preset === "1y") start = shiftByMonths(baseDate, -12);
  return {
    startDate: toIsoDate(start),
    endDate: toIsoDate(end),
  };
}

export function formatDateByLocale(isoDate: string, locale: Locale): string {
  if (!isIsoDate(isoDate)) return isoDate;
  if (locale === "en") return isoDate;
  const [year, month, day] = isoDate.split("-");
  return `${year}年${month}月${day}日`;
}
