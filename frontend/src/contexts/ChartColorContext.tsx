import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type ChartColorMode = "greenUpRedDown" | "redUpGreenDown";

type ChartColorPalette = {
  up: string;
  down: string;
  holdUp: string;
  holdDown: string;
};

interface ChartColorContextType {
  mode: ChartColorMode;
  setMode: (mode: ChartColorMode) => void;
  palette: ChartColorPalette;
}

const STORAGE_KEY = "aipha-chart-color-mode";

const ChartColorContext = createContext<ChartColorContextType | undefined>(undefined);

function toPalette(mode: ChartColorMode): ChartColorPalette {
  if (mode === "redUpGreenDown") {
    return {
      up: "#dc2626",
      down: "#16a34a",
      holdUp: "rgba(220, 38, 38, 0.10)",
      holdDown: "rgba(22, 163, 74, 0.10)",
    };
  }
  return {
    up: "#16a34a",
    down: "#dc2626",
    holdUp: "rgba(22, 163, 74, 0.10)",
    holdDown: "rgba(220, 38, 38, 0.10)",
  };
}

export function ChartColorProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ChartColorMode>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "redUpGreenDown" ? "redUpGreenDown" : "greenUpRedDown";
  });

  const setMode = useCallback((next: ChartColorMode) => {
    setModeState(next);
    localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const value = useMemo<ChartColorContextType>(() => {
    return {
      mode,
      setMode,
      palette: toPalette(mode),
    };
  }, [mode, setMode]);

  return <ChartColorContext.Provider value={value}>{children}</ChartColorContext.Provider>;
}

export function useChartColor() {
  const ctx = useContext(ChartColorContext);
  if (!ctx) {
    throw new Error("useChartColor must be used within ChartColorProvider");
  }
  return ctx;
}

