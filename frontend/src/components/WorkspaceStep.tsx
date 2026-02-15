// ============================================================
// WorkspaceStep - Individual step card in AI Workspace
// ============================================================

import { CheckCircle2, Loader2, Circle, AlertCircle } from "lucide-react";
import { useI18n } from "@/contexts/I18nContext";
import { formatDateByLocale, isIsoDate } from "@/lib/date";
import type { StepInfo } from "@/lib/api";

type StepStatus = StepInfo["status"];
type SubtaskStatus = "queued" | "running" | "done" | "error";

interface WorkspaceStepProps {
  step: StepInfo;
  isLast: boolean;
  progress: number;
}

function StatusIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case "done":
      return <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />;
    case "running":
      return <Loader2 className="w-5 h-5 text-foreground animate-spin shrink-0" />;
    case "queued":
      return <Circle className="w-5 h-5 text-muted-foreground/30 shrink-0" />;
    case "warn":
      return <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />;
    case "error":
      return <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />;
  }
}

function SubtaskStatusIcon({ status }: { status: SubtaskStatus }) {
  if (status === "running") return <Loader2 className="w-3.5 h-3.5 text-foreground animate-spin shrink-0" />;
  if (status === "done") return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />;
  if (status === "error") return <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />;
  return <Circle className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />;
}

function normalizeLogMessage(log: string): string {
  return log
    .replace(/^\d{1,2}:\d{2}:\d{2}\s*/i, "")
    .replace(/^\[(DEBUG|INFO|WARN|ERROR)\]\s*/i, "")
    .trim();
}

function localizeSubtask(raw: string, locale: "en" | "zh"): string {
  const line = normalizeLogMessage(raw);

  const parseReady = line.match(/^Strategy ready \(LLM:\s*([^,]+),\s*attempts:\s*(\d+)\)$/i);
  if (parseReady) {
    const model = parseReady[1];
    const attempts = parseReady[2];
    return locale === "zh" ? `策略解析完成（模型：${model}，尝试：${attempts}次）` : `Strategy ready (LLM: ${model}, attempts: ${attempts})`;
  }

  if (/^Parsing strategy/i.test(line)) return locale === "zh" ? "正在使用大模型解析策略" : "Parsing strategy with LLM";
  if (/^DSL artifact persisted$/i.test(line)) return locale === "zh" ? "DSL 已生成" : "DSL generated";
  if (/^Input snapshot generated$/i.test(line)) return locale === "zh" ? "输入快照已生成" : "Input snapshot generated";
  if (/^Building execution plan$/i.test(line)) return locale === "zh" ? "正在构建执行计划" : "Building execution plan";
  if (/^ExecutionPlan compiled$/i.test(line)) return locale === "zh" ? "执行计划构建完成" : "Execution plan compiled";
  if (/^Fetching minute data$/i.test(line)) return locale === "zh" ? "正在获取分钟级行情数据" : "Fetching minute market data";
  if (/^Validating session coverage$/i.test(line)) return locale === "zh" ? "正在校验交易日覆盖" : "Validating session coverage";

  const dataReady = line.match(/^Data ready \((\d{4}-\d{2}-\d{2}) -> (\d{4}-\d{2}-\d{2})\)$/i);
  if (dataReady) {
    const start = dataReady[1];
    const end = dataReady[2];
    if (locale === "zh") return `数据已就绪（${formatDateByLocale(start, "zh")} 至 ${formatDateByLocale(end, "zh")}）`;
    return `Data ready (${start} -> ${end})`;
  }

  const backtest = line.match(/^Backtesting\s+(\d{4}-\d{2}-\d{2})\s+\((\d+)\/(\d+),\s*([\d.]+)%\)$/i);
  if (backtest) {
    const date = backtest[1];
    const done = backtest[2];
    const total = backtest[3];
    const pct = backtest[4];
    if (locale === "zh") return `回测进行中：${formatDateByLocale(date, "zh")}（${done}/${total}，${pct}%）`;
    return `Backtesting ${date} (${done}/${total}, ${pct}%)`;
  }

  if (/^Running backtest$/i.test(line)) return locale === "zh" ? "正在运行回测引擎" : "Running backtest engine";
  if (/^Backtest completed$/i.test(line)) return locale === "zh" ? "回测完成" : "Backtest completed";
  if (/^Generating report$/i.test(line)) return locale === "zh" ? "正在生成报告" : "Generating report";
  if (/^Report artifact persisted$/i.test(line)) return locale === "zh" ? "报告文件已保存" : "Report artifact persisted";
  if (/^KPI snapshot generated$/i.test(line)) return locale === "zh" ? "KPI 快照已生成" : "KPI snapshot generated";
  if (/^Report ready$/i.test(line)) return locale === "zh" ? "报告生成完成" : "Report ready";
  if (/^Awaiting confirm$/i.test(line)) return locale === "zh" ? "等待部署确认" : "Awaiting deployment confirmation";

  if (line.includes("failed") || line.includes("Unhandled")) {
    return locale === "zh" ? "步骤执行失败" : "Step failed";
  }

  // Keep short and readable for unrecognized entries.
  if (isIsoDate(line.slice(0, 10)) && locale === "zh") {
    return line.replace(line.slice(0, 10), formatDateByLocale(line.slice(0, 10), "zh"));
  }
  return line;
}

function inferSubtaskStatus(step: StepInfo, label: string, index: number, total: number): SubtaskStatus {
  const lower = label.toLowerCase();
  if (lower.includes("failed") || lower.includes("error")) return "error";
  if (step.status === "error" && index === total - 1) return "error";
  if (step.status === "running" && index === total - 1) return "running";
  if (step.status === "queued") return "queued";
  if (step.status === "done") return "done";
  return "done";
}

function buildSubtasks(step: StepInfo, locale: "en" | "zh"): Array<{ label: string; status: SubtaskStatus }> {
  const labels = step.logs.map((log) => localizeSubtask(log, locale)).filter(Boolean);
  if (labels.length === 0) return [];

  return labels.map((label, idx) => ({
    label,
    status: inferSubtaskStatus(step, label, idx, labels.length),
  }));
}

function SubtaskList({ step }: { step: StepInfo }) {
  const { locale } = useI18n();
  const tasks = buildSubtasks(step, locale);
  if (tasks.length === 0) return null;

  return (
    <div className="mt-2.5 border border-border rounded-md p-3 bg-muted/30">
      <div className="space-y-1.5">
        {tasks.slice(-6).map((task, idx) => (
          <div key={`${task.label}-${idx}`} className="flex items-center gap-2">
            <SubtaskStatusIcon status={task.status} />
            <span className="text-xs text-muted-foreground truncate" title={task.label}>
              {task.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function WorkspaceStepCard({ step, isLast }: WorkspaceStepProps) {
  const isActive = step.status === "running" || step.status === "done" || step.status === "error";

  const stepTitleMap: Record<string, string> = {
    parse: "PARSE",
    plan: "PLAN",
    data: "DATA",
    backtest: "BACKTEST",
    report: "REPORT",
    deploy: "DEPLOY",
  };

  const statusLabelMap: Record<string, string> = {
    running: "Running",
  };

  return (
    <div className="relative">
      {!isLast && <div className="absolute left-[18px] top-[40px] bottom-[-12px] w-px bg-border" />}

      <div
        className={`
          relative border rounded-lg p-4 transition-all duration-200
          ${step.status === "running"
            ? "border-foreground/20 bg-card shadow-md ring-1 ring-foreground/5"
            : step.status === "error"
              ? "border-red-200 dark:border-red-800 bg-red-50/30 dark:bg-red-950/20"
              : step.status === "done"
                ? "border-border bg-card"
                : "border-border/60 bg-card/60"
          }
        `}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <StatusIcon status={step.status} />
            <span className="text-xs font-bold tracking-wider text-foreground uppercase">
              {stepTitleMap[step.key] || step.title}
            </span>
          </div>
          {step.status === "running" && (
            <span className="text-[10px] font-bold text-white bg-emerald-500 px-2 py-0.5 rounded-full">
              {statusLabelMap.running}
            </span>
          )}
        </div>

        {isActive && (
          <div className="ml-[30px]">
            <SubtaskList step={step} />
          </div>
        )}
      </div>
    </div>
  );
}
