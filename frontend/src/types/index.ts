// ============================================================
// Aipha Vibe Trading System v0 - Type Definitions
// All types aligned with server API responses
// ============================================================

export type AppStatus = 'idle' | 'running' | 'completed' | 'failed';
export type StepStatus = 'queued' | 'running' | 'done' | 'warn' | 'error';
export type NavTab = 'backtest' | 'paper' | 'live';

export interface ChipFilter {
  id: string;
  label: string;
  active: boolean;
}

// Re-export from API for convenience
export type { StepInfo, RunStatusResponse, RunReportResponse, DeployResponse } from '@/lib/api';
