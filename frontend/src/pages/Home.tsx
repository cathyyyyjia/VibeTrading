// ============================================================
// Home Page - Main application layout
// Design: Swiss Precision
// Layout: TopNav + Left (Strategy Designer 65%) + Right (AI Workspace 35%)
// ============================================================

import { useState } from 'react';
import TopNav from '@/components/TopNav';
import StrategyDesigner from '@/components/StrategyDesigner';
import AIWorkspace from '@/components/AIWorkspace';
import BottomBar from '@/components/BottomBar';
import DeployModal from '@/components/DeployModal';
import { useBacktest } from '@/hooks/useBacktest';

export default function Home() {
  const {
    status,
    prompt,
    runId,
    steps,
    progress,
    artifacts,
    report,
    error: backtestError,
    statusMessage,
    indicatorPreferences,
    backtestWindowPreset,
    backtestStartDate,
    backtestEndDate,
    setPrompt,
    setIndicatorPreferences,
    setBacktestWindowPreset,
    setBacktestDateRange,
    runBacktest,
    revisePrompt,
    deploy,
    retry,
  } = useBacktest();

  const [deployModalOpen, setDeployModalOpen] = useState(false);

  return (
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
      {/* Top Navigation */}
      <TopNav />

      {/* Main Content: Two Columns */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Column: Strategy Designer (65%) */}
        <div className="w-[65%] border-r border-border flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto">
            <StrategyDesigner
              status={status}
              prompt={prompt}
              onPromptChange={setPrompt}
              onRunBacktest={runBacktest}
              indicatorPreferences={indicatorPreferences}
              onIndicatorPreferencesChange={setIndicatorPreferences}
              backtestWindowPreset={backtestWindowPreset}
              backtestStartDate={backtestStartDate}
              backtestEndDate={backtestEndDate}
              onBacktestWindowPresetChange={setBacktestWindowPreset}
              onBacktestDateRangeChange={setBacktestDateRange}
              report={report}
              runId={runId}
              error={backtestError}
              onRetry={retry}
            />
          </div>
          {/* Bottom Bar inside left column */}
          <BottomBar
            status={status}
            onRevise={revisePrompt}
            onDeploy={() => setDeployModalOpen(true)}
          />
        </div>

        {/* Right Column: AI Workspace (35%) */}
        <div className="w-[35%] overflow-hidden">
          <AIWorkspace
            status={status}
            runId={runId}
            steps={steps}
            progress={progress}
            artifacts={artifacts}
          />
        </div>
      </div>

      {/* Deploy Modal */}
      <DeployModal
        isOpen={deployModalOpen}
        onClose={() => setDeployModalOpen(false)}
        onConfirm={deploy}
        report={report}
      />
    </div>
  );
}
