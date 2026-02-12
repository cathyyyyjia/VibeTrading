import { useState, useCallback, useRef, useEffect } from "react";
import * as api from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type { RunStatusResponse, RunReportResponse, StepInfo, AnalyzeResponse } from "@/lib/api";

export type AppStatus = "idle" | "analyzing" | "running" | "completed" | "failed";

export interface ChipFilter {
  id: string;
  label: string;
  active: boolean;
}

export interface UseBacktestReturn {
  status: AppStatus;
  prompt: string;
  filters: ChipFilter[];
  runId: string | null;
  strategyId: string | null;
  steps: StepInfo[];
  progress: number;
  artifacts: RunStatusResponse["artifacts"] | null;
  report: RunReportResponse | null;
  analyzeResult: AnalyzeResponse | null;
  error: string | null;
  statusMessage: string;
  setPrompt: (v: string) => void;
  toggleFilter: (id: string) => void;
  runBacktest: () => void;
  revisePrompt: () => void;
  deploy: (mode: "paper" | "live") => Promise<api.DeployResponse>;
  retry: () => void;
}

const POLL_INTERVAL = 800;

export function useBacktest(): UseBacktestReturn {
  const [status, setStatus] = useState<AppStatus>("idle");
  const [prompt, setPrompt] = useState("");
  const [filters, setFilters] = useState<ChipFilter[]>([
    { id: "transactionCosts", label: "Transaction Costs", active: false },
    { id: "dateRange", label: "Date Range", active: false },
    { id: "maxDrawdown", label: "Max Drawdown", active: false },
  ]);
  const [runId, setRunId] = useState<string | null>(null);
  const [strategyId, setStrategyId] = useState<string | null>(null);
  const [steps, setSteps] = useState<StepInfo[]>([]);
  const [progress, setProgress] = useState(0);
  const [artifacts, setArtifacts] = useState<RunStatusResponse["artifacts"] | null>(null);
  const [report, setReport] = useState<RunReportResponse | null>(null);
  const [analyzeResult, setAnalyzeResult] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentRunIdRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const pollStatus = useCallback(
    async (rid: string) => {
      try {
        const statusData = await api.getRunStatus(rid);
        if (currentRunIdRef.current !== rid) return;

        setSteps(statusData.steps);
        setProgress(statusData.progress);

        if (statusData.state === "running") {
          setStatus("running");
          const runningStep = statusData.steps.find((s) => s.status === "running");
          if (runningStep) {
            const stepMessages: Record<string, string> = {
              parse: "Parsing strategy spec...",
              plan: "Compiling execution plan...",
              data: "Fetching and validating market data...",
              backtest: "Running backtest engine...",
              report: "Generating report artifacts...",
              deploy: "Preparing deployment...",
            };
            setStatusMessage(stepMessages[runningStep.key] || "Processing...");
          } else {
            setStatusMessage("Processing...");
          }
        } else if (statusData.state === "completed") {
          setStatus("completed");
          setArtifacts(statusData.artifacts);
          setStatusMessage("Backtest completed successfully");
          stopPolling();

          try {
            const reportData = await api.getRunReport(rid);
            if (currentRunIdRef.current === rid) {
              setReport(reportData);
            }
          } catch (e) {
            console.error("Failed to fetch report:", e);
          }
        } else if (statusData.state === "failed") {
          setStatus("failed");
          stopPolling();
          const failedStep = statusData.steps.find((s) => s.status === "error");
          const errorMsg = failedStep
            ? `${failedStep.title} failed: ${failedStep.logs.find((l) => l.startsWith("[ERROR]")) || "Unknown error"}`
            : "Backtest failed due to an unknown error";
          setError(errorMsg);
          setStatusMessage("Backtest failed");
        }
      } catch (e) {
        console.error("Polling error:", e);
      }
    },
    [stopPolling]
  );

  const startPolling = useCallback(
    (rid: string) => {
      stopPolling();
      pollStatus(rid);
      pollingRef.current = setInterval(() => pollStatus(rid), POLL_INTERVAL);
    },
    [pollStatus, stopPolling]
  );

  const runBacktest = useCallback(async () => {
    if (!prompt.trim()) return;

    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      setStatus("idle");
      setError("Please login first.");
      setStatusMessage("Authentication required");
      return;
    }

    setStatus("analyzing");
    setError(null);
    setReport(null);
    setArtifacts(null);
    setAnalyzeResult(null);
    setSteps([]);
    setProgress(0);
    setStatusMessage("Analyzing strategy...");

    try {
      const options: Record<string, unknown> = {};
      filters.forEach((f) => {
        if (f.active) options[f.id] = true;
      });

      const { runId: newRunId } = await api.createRun(prompt, { ...options, mode: "BACKTEST_ONLY" });
      setStatus("running");
      setRunId(newRunId);
      setStrategyId(null);
      currentRunIdRef.current = newRunId;
      startPolling(newRunId);
    } catch (e) {
      console.error("Failed to start backtest:", e);
      setStatus("failed");
      setError("Failed to start backtest. Please try again.");
      setStatusMessage("Failed to initialize");
    }
  }, [filters, prompt, startPolling]);

  const revisePrompt = useCallback(() => {
    stopPolling();
    setStatus("idle");
    setRunId(null);
    setStrategyId(null);
    currentRunIdRef.current = null;
    setSteps([]);
    setProgress(0);
    setArtifacts(null);
    setReport(null);
    setAnalyzeResult(null);
    setError(null);
    setStatusMessage("");
  }, [stopPolling]);

  const deploy = useCallback(
    async (mode: "paper" | "live"): Promise<api.DeployResponse> => {
      if (!runId) throw new Error("No run to deploy");
      return api.deployRun(runId, mode);
    },
    [runId]
  );

  const retry = useCallback(() => {
    runBacktest();
  }, [runBacktest]);

  const toggleFilter = useCallback((id: string) => {
    setFilters((prev) => prev.map((f) => (f.id === id ? { ...f, active: !f.active } : f)));
  }, []);

  return {
    status,
    prompt,
    filters,
    runId,
    strategyId,
    steps,
    progress,
    artifacts,
    report,
    analyzeResult,
    error,
    statusMessage,
    setPrompt,
    toggleFilter,
    runBacktest,
    revisePrompt,
    deploy,
    retry,
  };
}
