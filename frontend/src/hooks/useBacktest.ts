import { useState, useCallback, useRef, useEffect } from "react";
import * as api from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type { RunStatusResponse, RunReportResponse, StepInfo } from "@/lib/api";
import type { RealtimeChannel } from "@supabase/supabase-js";

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
  error: string | null;
  statusMessage: string;
  setPrompt: (v: string) => void;
  toggleFilter: (id: string) => void;
  runBacktest: () => void;
  revisePrompt: () => void;
  deploy: (mode: "paper" | "live") => Promise<api.DeployResponse>;
  retry: () => void;
}

const POLL_INTERVAL_INITIAL = 1500;
const POLL_INTERVAL_FALLBACK = 12000;
const POLL_INTERVAL_MAX = 20000;
const POLL_INTERVAL_REALTIME_HEARTBEAT = 30000;
const RUN_REALTIME_ENABLED = ((import.meta as any).env?.VITE_RUN_REALTIME_ENABLED ?? "true") !== "false";

function buildInitialWorkspaceSteps(): StepInfo[] {
  return [
    { key: "parse", title: "Parse Strategy", status: "running", durationMs: null, logs: [] },
    { key: "plan", title: "Build Execution Plan", status: "queued", durationMs: null, logs: [] },
    { key: "data", title: "Fetch & Validate Data", status: "queued", durationMs: null, logs: [] },
    { key: "backtest", title: "Backtest Engine", status: "queued", durationMs: null, logs: [] },
    { key: "report", title: "Generate Report", status: "queued", durationMs: null, logs: [] },
    { key: "deploy", title: "Deploy", status: "queued", durationMs: null, logs: [] },
  ];
}

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
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");

  const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const realtimeRef = useRef<RealtimeChannel | null>(null);
  const currentRunIdRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  const errorStreakRef = useRef(0);
  const realtimeSubscribedRef = useRef(false);

  useEffect(() => {
    return () => {
      if (pollingRef.current) clearTimeout(pollingRef.current);
      if (realtimeRef.current) {
        void supabase.removeChannel(realtimeRef.current);
        realtimeRef.current = null;
      }
      realtimeSubscribedRef.current = false;
    };
  }, []);

  const stopRealtime = useCallback(() => {
    if (realtimeRef.current) {
      void supabase.removeChannel(realtimeRef.current);
      realtimeRef.current = null;
    }
    realtimeSubscribedRef.current = false;
  }, []);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearTimeout(pollingRef.current);
      pollingRef.current = null;
    }
    inFlightRef.current = false;
    errorStreakRef.current = 0;
  }, []);

  const pollStatus = useCallback(
    async (rid: string, source: "start" | "realtime" | "poll" = "poll") => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      let nextDelay = source === "start" ? POLL_INTERVAL_INITIAL : POLL_INTERVAL_FALLBACK;
      let shouldContinue = true;
      try {
        const statusData = await api.getRunStatus(rid);
        if (currentRunIdRef.current !== rid) return;
        errorStreakRef.current = 0;

        setSteps(statusData.steps);
        const runningStep = statusData.steps.find((s) => s.status === "running");
        let displayProgress = statusData.progress;
        if (runningStep?.key === "backtest") {
          const latestLog = [...runningStep.logs].reverse().find((log) => log.includes("Backtesting ")) || "";
          const m = latestLog.match(/Backtesting\s+(\d{4}-\d{2}-\d{2})\s+\((\d+)\/(\d+),\s*([\d.]+)%\)/);
          if (m) {
            const parsedPct = Number(m[4]);
            if (!Number.isNaN(parsedPct)) {
              displayProgress = parsedPct;
            }
          }
        }
        setProgress(displayProgress);

        if (statusData.state === "running") {
          setStatus("running");
          if (runningStep) {
            if (runningStep.key === "backtest") {
              const latestLog = runningStep.logs[runningStep.logs.length - 1] || "";
              const m = latestLog.match(/Backtesting\s+(\d{4}-\d{2}-\d{2})\s+\((\d+)\/(\d+),\s*([\d.]+)%\)/);
              if (m) {
                setStatusMessage(`Backtesting ${m[1]} (${m[2]}/${m[3]}, ${m[4]}%)`);
                return;
              }
            }
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
          setProgress(100);
          setArtifacts(statusData.artifacts);
          setStatusMessage("Backtest completed successfully");
          stopPolling();
          stopRealtime();
          shouldContinue = false;

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
          stopRealtime();
          shouldContinue = false;
          const failedStep = statusData.steps.find((s) => s.status === "error");
          const errorMsg = failedStep
            ? `${failedStep.title} failed: ${failedStep.logs.find((l) => l.startsWith("[ERROR]")) || "Unknown error"}`
            : "Backtest failed due to an unknown error";
          setError(errorMsg);
          setStatusMessage("Backtest failed");
        }
      } catch (e) {
        errorStreakRef.current += 1;
        const backoff = Math.min(POLL_INTERVAL_MAX, POLL_INTERVAL_INITIAL * (2 ** Math.min(errorStreakRef.current, 4)));
        nextDelay = backoff;
        console.error("Polling error:", e);
      } finally {
        inFlightRef.current = false;
        if (shouldContinue && currentRunIdRef.current === rid) {
          if (pollingRef.current) {
            clearTimeout(pollingRef.current);
          }
          const realtimeHealthy = RUN_REALTIME_ENABLED && realtimeSubscribedRef.current;
          const scheduleDelay = realtimeHealthy ? Math.max(nextDelay, POLL_INTERVAL_REALTIME_HEARTBEAT) : nextDelay;
          pollingRef.current = setTimeout(() => {
            void pollStatus(rid, "poll");
          }, scheduleDelay);
        }
      }
    },
    [stopPolling, stopRealtime]
  );

  const subscribeRealtime = useCallback(
    (rid: string) => {
      stopRealtime();
      if (!RUN_REALTIME_ENABLED) return;

      const channel = supabase
        .channel(`run-status:${rid}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "runs", filter: `id=eq.${rid}` },
          () => {
            void pollStatus(rid, "realtime");
          }
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "run_steps", filter: `run_id=eq.${rid}` },
          () => {
            void pollStatus(rid, "realtime");
          }
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "run_artifacts", filter: `run_id=eq.${rid}` },
          () => {
            void pollStatus(rid, "realtime");
          }
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            realtimeSubscribedRef.current = true;
          } else if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            realtimeSubscribedRef.current = false;
          }
          if (status === "SUBSCRIBED" && currentRunIdRef.current === rid) {
            void pollStatus(rid, "realtime");
          }
        });

      realtimeRef.current = channel;
    },
    [pollStatus, stopRealtime]
  );

  const startTracking = useCallback(
    (rid: string) => {
      stopPolling();
      subscribeRealtime(rid);
      void pollStatus(rid, "start");
    },
    [pollStatus, stopPolling, subscribeRealtime]
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
    setSteps(buildInitialWorkspaceSteps());
    setProgress(0);
    setStatusMessage("Waiting for run to start...");

    try {
      const options: Record<string, unknown> = {};
      filters.forEach((f) => {
        if (f.active) options[f.id] = true;
      });

      const { runId: newRunId } = await api.createRun(prompt, { ...options, mode: "BACKTEST_ONLY" });
      setStatus("running");
      setRunId(newRunId);
      setStrategyId(null);
      setStatusMessage("Run created. Initializing parser...");
      currentRunIdRef.current = newRunId;
      startTracking(newRunId);
    } catch (e) {
      console.error("Failed to start backtest:", e);
      setStatus("failed");
      setError("Failed to start backtest. Please try again.");
      setStatusMessage("Failed to initialize");
    }
  }, [filters, prompt, startTracking]);

  const revisePrompt = useCallback(() => {
    stopPolling();
    stopRealtime();
    setStatus("idle");
    setRunId(null);
    setStrategyId(null);
    currentRunIdRef.current = null;
    setSteps([]);
    setProgress(0);
    setArtifacts(null);
    setReport(null);
    setError(null);
    setStatusMessage("");
  }, [stopPolling, stopRealtime]);

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
