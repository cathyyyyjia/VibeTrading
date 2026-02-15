import { describe, expect, it, vi } from "vitest";

import { formatDateByLocale, getPresetDateRange, isIsoDate, parseIsoDate, toIsoDate } from "@/lib/date";

describe("date utils", () => {
  it("formats ISO dates by locale", () => {
    expect(formatDateByLocale("2026-02-15", "en")).toBe("2026-02-15");
    expect(formatDateByLocale("2026-02-15", "zh")).toBe("2026年02月15日");
  });

  it("validates and parses ISO dates", () => {
    expect(isIsoDate("2026-02-15")).toBe(true);
    expect(isIsoDate("2026/02/15")).toBe(false);
    expect(parseIsoDate("2026-02-15")).not.toBeNull();
    expect(parseIsoDate("2026-02-30")).toBeNull();
  });

  it("builds 1y preset range from current date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-15T10:00:00Z"));
    const range = getPresetDateRange("1y", new Date());
    expect(range).toEqual({
      startDate: "2025-02-15",
      endDate: "2026-02-15",
    });
    vi.useRealTimers();
  });

  it("builds all preset range from 2023-01-01 to current date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-15T10:00:00Z"));
    const range = getPresetDateRange("all", new Date());
    expect(range).toEqual({
      startDate: "2023-01-01",
      endDate: "2026-02-15",
    });
    vi.useRealTimers();
  });

  it("formats Date to ISO date", () => {
    expect(toIsoDate(new Date(2026, 1, 5))).toBe("2026-02-05");
  });
});
