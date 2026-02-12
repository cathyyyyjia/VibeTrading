// ============================================================
// I18n Context - 中英文国际化
// ============================================================

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

export type Locale = 'en' | 'zh';

interface I18nContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
  t: (key: string) => string;
}

const translations: Record<Locale, Record<string, string>> = {
  en: {
    // TopNav
    'nav.backtest': 'Backtest',
    'nav.paper': 'Paper',
    'nav.live': 'Live',
    'nav.proPlan': 'Pro Plan',

    // Strategy Designer
    'strategy.title': 'Strategy Designer',
    'strategy.subtitle': 'Define your trading algorithm using natural language.',
    'strategy.placeholder': 'e.g., Buy BTC when the 50-day MA crosses above the 200-day MA...',
    'strategy.runBacktest': 'Run Backtest',
    'strategy.running': 'Running...',

    // Example prompts
    'example.trend': 'Trend-following example',
    'example.meanReversion': 'Mean-reversion example',
    'example.multiTimeframe': 'Multi-timeframe sell signal',

    // Filters
    'filter.transactionCosts': '+ Transaction Costs',
    'filter.dateRange': '+ Date Range',
    'filter.maxDrawdown': '+ Max Drawdown',

    // Simulation
    'sim.latestSimulation': 'Latest Simulation',
    'sim.return': 'RETURN',
    'sim.cagr': 'CAGR',
    'sim.sharpe': 'SHARPE',
    'sim.maxDd': 'MAX DD',

    // Trade Table
    'trade.title': 'Trade Execution Log',
    'trade.exportCsv': 'Export CSV',
    'trade.timestamp': 'Timestamp',
    'trade.symbol': 'Symbol',
    'trade.action': 'Action',
    'trade.price': 'Price',
    'trade.pnl': 'P/L',
    'trade.noTrades': 'No trades to display',

    // History
    'history.title': 'Backtest History',
    'history.runs': 'runs',
    'history.completed': 'Completed',
    'history.failed': 'Failed',
    'history.return': 'Return',
    'history.performanceMetrics': 'Performance Metrics',
    'history.equityCurve': 'Equity Curve',
    'history.trades': 'Trades',
    'history.strategyDsl': 'Strategy DSL',
    'history.copy': 'Copy',
    'history.loadStrategy': 'Load Strategy',
    'history.loadingReport': 'Loading report...',
    'history.loadFailed': 'Failed to load history',
    'history.dslCopied': 'DSL copied to clipboard',
    'history.promptLoaded': 'Prompt loaded',
    'history.delete': 'Delete',
    'history.deleteConfirm': 'Delete this strategy and all related runs?',
    'history.deleteSuccess': 'Strategy deleted',
    'history.deleteFailed': 'Failed to delete strategy',

    // AI Workspace
    'workspace.title': 'AI Workspace',
    'workspace.subtitle': 'Processing natural language strategy definition...',
    'workspace.readyTitle': 'Ready to analyze',
    'workspace.readySubtitle': 'Enter a trading strategy in natural language and click Run Backtest to begin.',
    'workspace.artifacts': 'Artifacts',
    'workspace.viewFullCode': 'View full strategy code',

    // Steps
    'step.strategicAnalysis': 'STRATEGIC ANALYSIS',
    'step.dataSynthesis': 'DATA SYNTHESIS',
    'step.logicConstruction': 'LOGIC CONSTRUCTION',
    'step.backtestEngine': 'BACKTEST ENGINE',
    'step.queued': 'QUEUED',
    'step.running': 'RUNNING',
    'step.done': 'DONE',
    'step.error': 'ERROR',
    'step.warn': 'WARN',

    // Artifacts
    'artifact.title': 'Artifacts',
    'artifact.strategyDsl': 'Strategy DSL',
    'artifact.backtestReport': 'Backtest Report',
    'artifact.tradesCsv': 'Trades CSV',
    'artifact.copy': 'Copy',
    'artifact.download': 'Download',
    'artifact.copied': 'Copied',
    'artifact.copiedDesc': 'Strategy DSL copied to clipboard',
    'artifact.copyFailed': 'Failed to copy',
    'artifact.comingSoon': 'Feature coming soon',
    'artifact.reportComingSoonDesc': 'Report download will be available when connected to real backend.',
    'artifact.csvComingSoonDesc': 'CSV download will be available when connected to real backend.',

    // Bottom Bar / Actions
    'action.revisePrompt': 'Revise Prompt',
    'action.confirmDeploy': 'Confirm & Deploy',

    // Deploy Modal
    'deploy.title': 'Deploy Strategy',
    'deploy.subtitle': 'Choose deployment target for your strategy.',
    'deploy.mode': 'Deployment Mode',
    'deploy.paper': 'Paper Trading',
    'deploy.paperDesc': 'Simulated execution',
    'deploy.live': 'Live Trading',
    'deploy.liveDesc': 'Real capital at risk',
    'deploy.liveWarningTitle': 'Real Capital at Risk',
    'deploy.liveWarningDesc': 'This strategy will execute with real funds. Ensure you have reviewed all parameters carefully.',
    'deploy.cancel': 'Cancel',
    'deploy.deploying': 'Deploying...',
    'deploy.deployTo': 'Deploy to',
    'deploy.success': 'Strategy deployed!',
    'deploy.failed': 'Deployment failed',
    'deploy.tryAgain': 'Please try again.',

    // Error
    'error.backtestFailed': 'Backtest Failed',
    'error.retryBacktest': 'Retry Backtest',
    'error.title': 'Backtest Failed',
    'error.retry': 'Retry',

    // Code Modal
    'code.title': 'Strategy Code',
    'code.subtitle': 'Auto-generated strategy code from your natural language prompt.',
    'code.copy': 'Copy Code',
    'code.copied': 'Copied!',

    // Status messages
    'status.analyzing': 'Analyzing risk parameters...',
    'status.idle': '',
  },
  zh: {
    // TopNav
    'nav.backtest': '回测',
    'nav.paper': '模拟盘',
    'nav.live': '实盘',
    'nav.proPlan': '专业版',

    // Strategy Designer
    'strategy.title': '策略设计器',
    'strategy.subtitle': '使用自然语言定义你的交易算法。',
    'strategy.placeholder': '例如：当50日均线上穿200日均线时买入BTC...',
    'strategy.runBacktest': '运行回测',
    'strategy.running': '运行中...',

    // Example prompts
    'example.trend': '趋势跟踪示例',
    'example.meanReversion': '均值回归示例',
    'example.multiTimeframe': '多周期卖出信号',

    // Filters
    'filter.transactionCosts': '+ 交易成本',
    'filter.dateRange': '+ 日期范围',
    'filter.maxDrawdown': '+ 最大回撤',

    // Simulation
    'sim.latestSimulation': '最新模拟',
    'sim.return': '收益率',
    'sim.cagr': '年化收益',
    'sim.sharpe': '夏普比率',
    'sim.maxDd': '最大回撤',

    // Trade Table
    'trade.title': '交易执行日志',
    'trade.exportCsv': '导出 CSV',
    'trade.timestamp': '时间',
    'trade.symbol': '标的',
    'trade.action': '操作',
    'trade.price': '价格',
    'trade.pnl': '盈亏',
    'trade.noTrades': '暂无交易记录',

    // History
    'history.title': '回测历史',
    'history.runs': '条记录',
    'history.completed': '已完成',
    'history.failed': '失败',
    'history.return': '收益率',
    'history.performanceMetrics': '绩效指标',
    'history.equityCurve': '权益曲线',
    'history.trades': '交易记录',
    'history.strategyDsl': '策略 DSL',
    'history.copy': '复制',
    'history.loadStrategy': '加载策略',
    'history.loadingReport': '加载报告中...',
    'history.loadFailed': '加载历史记录失败',
    'history.dslCopied': 'DSL 已复制到剪贴板',
    'history.promptLoaded': '策略已加载',
    'history.delete': '删除',
    'history.deleteConfirm': '删除该策略及相关回测数据？',
    'history.deleteSuccess': '策略已删除',
    'history.deleteFailed': '删除策略失败',

    // AI Workspace
    'workspace.title': 'AI 工作区',
    'workspace.subtitle': '正在处理自然语言策略定义...',
    'workspace.readyTitle': '准备就绪',
    'workspace.readySubtitle': '输入自然语言交易策略，然后点击运行回测开始。',
    'workspace.artifacts': '产出物',
    'workspace.viewFullCode': '查看完整策略代码',

    // Steps
    'step.strategicAnalysis': '策略分析',
    'step.dataSynthesis': '数据合成',
    'step.logicConstruction': '逻辑构建',
    'step.backtestEngine': '回测引擎',
    'step.queued': '排队中',
    'step.running': '运行中',
    'step.done': '完成',
    'step.error': '错误',
    'step.warn': '警告',

    // Artifacts
    'artifact.title': '产出物',
    'artifact.strategyDsl': '策略 DSL',
    'artifact.backtestReport': '回测报告',
    'artifact.tradesCsv': '交易 CSV',
    'artifact.copy': '复制',
    'artifact.download': '下载',
    'artifact.copied': '已复制',
    'artifact.copiedDesc': '策略 DSL 已复制到剪贴板',
    'artifact.copyFailed': '复制失败',
    'artifact.comingSoon': '功能即将上线',
    'artifact.reportComingSoonDesc': '接入真实后端后即可下载报告。',
    'artifact.csvComingSoonDesc': '接入真实后端后即可下载 CSV。',

    // Bottom Bar / Actions
    'action.revisePrompt': '修改策略',
    'action.confirmDeploy': '确认部署',

    // Deploy Modal
    'deploy.title': '部署策略',
    'deploy.subtitle': '选择策略的部署目标。',
    'deploy.mode': '部署模式',
    'deploy.paper': '模拟交易',
    'deploy.paperDesc': '模拟执行，不涉及真实资金',
    'deploy.live': '实盘交易',
    'deploy.liveDesc': '涉及真实资金风险',
    'deploy.liveWarningTitle': '涉及真实资金风险',
    'deploy.liveWarningDesc': '此策略将使用真实资金执行，请确保已仔细审查所有参数。',
    'deploy.cancel': '取消',
    'deploy.deploying': '部署中...',
    'deploy.deployTo': '部署到',
    'deploy.success': '策略已部署！',
    'deploy.failed': '部署失败',
    'deploy.tryAgain': '请重试。',

    // Error
    'error.backtestFailed': '回测失败',
    'error.retryBacktest': '重试回测',
    'error.title': '回测失败',
    'error.retry': '重试',

    // Code Modal
    'code.title': '策略代码',
    'code.subtitle': '根据自然语言提示自动生成的策略代码。',
    'code.copy': '复制代码',
    'code.copied': '已复制！',

    // Status messages
    'status.analyzing': '正在分析风险参数...',
    'status.idle': '',
  },
};

const I18nContext = createContext<I18nContextType | undefined>(undefined);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const saved = localStorage.getItem('aipha-locale');
    return (saved === 'zh' ? 'zh' : 'en') as Locale;
  });

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    localStorage.setItem('aipha-locale', newLocale);
  }, []);

  const toggleLocale = useCallback(() => {
    setLocaleState(prev => {
      const next = prev === 'en' ? 'zh' : 'en';
      localStorage.setItem('aipha-locale', next);
      return next;
    });
  }, []);

  const t = useCallback((key: string): string => {
    return translations[locale][key] ?? key;
  }, [locale]);

  return (
    <I18nContext.Provider value={{ locale, setLocale, toggleLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
