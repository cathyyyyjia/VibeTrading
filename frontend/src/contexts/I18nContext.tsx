import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

export type Locale = "en" | "zh";

interface I18nContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
  t: (key: string) => string;
}

const en: Record<string, string> = {
  "nav.backtest": "Backtest",
  "nav.paper": "Paper",
  "nav.live": "Live",
  "nav.switchToDark": "Switch to dark mode",
  "nav.switchToLight": "Switch to light mode",
  "nav.switchToChinese": "Switch to Chinese",
  "nav.switchToEnglish": "Switch to English",
  "nav.profile": "Profile",
  "nav.logout": "Log out",
  "nav.profileTitle": "Profile",
  "nav.profileDesc": "Manage your public display information.",
  "nav.profileUpdated": "Profile updated",
  "nav.profileUpdateFailed": "Failed to update profile",
  "nav.email": "Email",
  "nav.displayName": "Display name",
  "nav.enterDisplayName": "Enter display name",
  "nav.user": "User",
  "nav.providerEmail": "Email",

  "strategy.title": "Strategy Designer",
  "strategy.subtitle": "Define your trading algorithm using natural language.",
  "strategy.placeholder": "e.g., Buy BTC when the 50-day MA crosses above the 200-day MA...",
  "strategy.runBacktest": "Run Backtest",
  "strategy.running": "Running...",
  "strategy.analyzing": "Analyzing...",
  "strategy.advancedParams": "Advanced",
  "strategy.advancedModuleIndicators": "MA / MACD",
  "strategy.advancedModuleBacktestWindow": "Backtest Window",
  "strategy.maWindow": "MA Window",
  "strategy.macdParams": "MACD Parameters (Fast / Slow / Signal)",
  "strategy.addCustom": "Custom",
  "strategy.maCustomPlaceholder": "Single MA",
  "strategy.macdFastPlaceholder": "Fast",
  "strategy.macdSlowPlaceholder": "Slow",
  "strategy.macdSignalPlaceholder": "Signal",
  "strategy.backtestWindow": "Backtest Window",
  "strategy.backtestPresetAll": "All",
  "strategy.backtestPreset1m": "1M",
  "strategy.backtestPreset3m": "3M",
  "strategy.backtestPreset6m": "6M",
  "strategy.backtestPreset1y": "1Y",
  "strategy.backtestPresetCustom": "Custom Range",
  "strategy.startDate": "Start Date",
  "strategy.endDate": "End Date",
  "strategy.invalidDateRange": "Invalid date range. Use YYYY-MM-DD and ensure start date is not later than end date.",

  "filter.transactionCosts": "+ Transaction Costs",
  "filter.dateRange": "+ Date Range",
  "filter.maxDrawdown": "+ Max Drawdown",

  "sim.latestSimulation": "Latest Simulation",
  "sim.indicatorConfig": "Indicator Config",
  "sim.ma": "MA",
  "sim.macd": "MACD",
  "sim.return": "RETURN",
  "sim.cagr": "CAGR",
  "sim.sharpe": "SHARPE",
  "sim.maxDd": "MAX DD",
  "sim.aiSummaryEn": "AI Summary",
  "sim.aiSummaryZh": "AI总结",

  "history.title": "Backtest History",
  "history.runs": "runs",
  "history.completed": "Completed",
  "history.failed": "Failed",
  "history.return": "Return",
  "history.performanceMetrics": "Performance Metrics",
  "history.equityCurve": "Equity Curve",
  "history.trades": "Trades",
  "history.strategyDsl": "Strategy DSL",
  "history.copy": "Copy",
  "history.loadStrategy": "Load Strategy",
  "history.loadingReport": "Loading report...",
  "history.loadFailed": "Failed to load history",
  "history.dslCopied": "DSL copied to clipboard",
  "history.promptLoaded": "Prompt loaded",
  "history.delete": "Delete",
  "history.deleteConfirm": "Delete this strategy and all related runs?",
  "history.deleteSuccess": "Strategy deleted",
  "history.deleteFailed": "Failed to delete strategy",
  "history.downloadResults": "Download Results",
  "history.downloadFailed": "Failed to download artifact",
  "trade.title": "TRADES",
  "trade.exportCsv": "EXPORT CSV",
  "trade.timestamp": "TIMESTAMP",
  "trade.symbol": "SYMBOL",
  "trade.action": "ACTION",
  "trade.price": "PRICE",
  "trade.pnl": "PNL",
  "trade.pnlPct": "PNL %",
  "trade.reason": "REASON",
  "chart.marketOhlc": "Market O/H/L/C",
  "chart.strategyCurve": "Strategy Curve",
  "chart.tradeMarker": "Trade Marker",
  "chart.marketUp": "Market Up",
  "chart.marketDown": "Market Down",

  "workspace.title": "AI Workspace",
  "workspace.subtitle": "Processing natural language strategy definition...",
  "workspace.readyTitle": "Ready to analyze",
  "workspace.readySubtitle": "Enter a trading strategy in natural language and click Run Backtest to begin.",
  "workspace.artifacts": "Artifacts",
  "workspace.step.parse": "PARSE",
  "workspace.step.plan": "PLAN",
  "workspace.step.data": "DATA",
  "workspace.step.backtest": "BACKTEST",
  "workspace.step.report": "REPORT",
  "workspace.step.deploy": "DEPLOY",
  "workspace.step.running": "Running",

  "artifact.title": "Artifacts",
  "artifact.strategyDsl": "Strategy DSL",
  "artifact.backtestReport": "Backtest Report",
  "artifact.tradesCsv": "Trades CSV",
  "artifact.copied": "Copied",
  "artifact.copiedDesc": "Strategy DSL copied to clipboard",
  "artifact.copyFailed": "Failed to copy",
  "artifact.comingSoon": "Feature coming soon",
  "artifact.reportComingSoonDesc": "Report download will be available when connected to real backend.",
  "artifact.csvComingSoonDesc": "CSV download will be available when connected to real backend.",

  "action.revisePrompt": "Revise Prompt",
  "action.confirmDeploy": "Confirm & Deploy",

  "deploy.title": "Deploy Strategy",
  "deploy.mode": "Deployment Mode",
  "deploy.paper": "Paper Trading",
  "deploy.paperDesc": "Simulated execution",
  "deploy.live": "Live Trading",
  "deploy.liveDesc": "Real capital at risk",
  "deploy.liveWarningTitle": "Real Capital at Risk",
  "deploy.liveWarningDesc": "This strategy will execute with real funds. Ensure you have reviewed all parameters carefully.",
  "deploy.cancel": "Cancel",
  "deploy.deploying": "Deploying...",
  "deploy.deployTo": "Deploy to",
  "deploy.success": "Strategy deployed!",
  "deploy.failed": "Deployment failed",
  "deploy.tryAgain": "Please try again.",

  "error.backtestFailed": "Backtest Failed",
  "error.retryBacktest": "Retry Backtest",

  "code.title": "Strategy Code",
  "code.copy": "Copy Code",
  "code.copied": "Copied!",

  "common.cancel": "Cancel",
  "common.save": "Save",
  "common.saving": "Saving...",
  "common.loading": "Loading...",

  "login.login": "Login",
  "login.signUp": "Sign Up",
  "login.createAccount": "Create a new account",
  "login.enterCredentials": "Enter your credentials to access the platform",
  "login.email": "Email",
  "login.password": "Password",
  "login.loading": "Loading...",
  "login.alreadyHaveAccount": "Already have an account? Login",
  "login.noAccount": "Don't have an account? Sign Up",
  "login.checkEmail": "Check your email for the confirmation link!",
  "login.loggedIn": "Successfully logged in!",
  "login.authFailed": "Authentication failed. Please try again.",
  "login.invalidCredentials": "Invalid email or password.",
  "login.emailNotConfirmed": "Please verify your email before signing in."
};

const zh: Record<string, string> = {
  "nav.backtest": "回测",
  "nav.paper": "模拟盘",
  "nav.live": "实盘",
  "nav.switchToDark": "切换到深色模式",
  "nav.switchToLight": "切换到浅色模式",
  "nav.switchToChinese": "切换到中文",
  "nav.switchToEnglish": "切换到英文",
  "nav.profile": "个人资料",
  "nav.logout": "退出登录",
  "nav.profileTitle": "个人资料",
  "nav.profileDesc": "管理你的公开展示信息。",
  "nav.profileUpdated": "资料已更新",
  "nav.profileUpdateFailed": "更新资料失败",
  "nav.email": "邮箱",
  "nav.displayName": "显示名称",
  "nav.enterDisplayName": "输入显示名称",
  "nav.user": "用户",
  "nav.providerEmail": "邮箱",

  "strategy.title": "策略设计器",
  "strategy.subtitle": "使用自然语言定义你的交易算法。",
  "strategy.placeholder": "例如：当 50 日均线上穿 200 日均线时买入 BTC...",
  "strategy.runBacktest": "运行回测",
  "strategy.running": "运行中...",
  "strategy.analyzing": "分析中...",
  "strategy.advancedParams": "高级",
  "strategy.advancedModuleIndicators": "MA / MACD",
  "strategy.advancedModuleBacktestWindow": "回测时间",
  "strategy.maWindow": "MA 窗口",
  "strategy.macdParams": "MACD 参数（快线 / 慢线 / 信号线）",
  "strategy.addCustom": "自定义",
  "strategy.maCustomPlaceholder": "单格MA",
  "strategy.macdFastPlaceholder": "Fast",
  "strategy.macdSlowPlaceholder": "Slow",
  "strategy.macdSignalPlaceholder": "Signal",
  "strategy.backtestWindow": "回测时间",
  "strategy.backtestPresetAll": "全部",
  "strategy.backtestPreset1m": "1个月",
  "strategy.backtestPreset3m": "3个月",
  "strategy.backtestPreset6m": "6个月",
  "strategy.backtestPreset1y": "1年",
  "strategy.backtestPresetCustom": "自定义区间",
  "strategy.startDate": "开始日期",
  "strategy.endDate": "结束日期",
  "strategy.invalidDateRange": "日期区间无效。请使用 YYYY-MM-DD，且开始日期不能晚于结束日期。",

  "filter.transactionCosts": "+ 交易成本",
  "filter.dateRange": "+ 日期范围",
  "filter.maxDrawdown": "+ 最大回撤",

  "sim.latestSimulation": "最近一次模拟",
  "sim.indicatorConfig": "指标配置",
  "sim.ma": "MA",
  "sim.macd": "MACD",
  "sim.return": "收益率",
  "sim.cagr": "年化收益",
  "sim.sharpe": "夏普比率",
  "sim.maxDd": "最大回撤",
  "sim.aiSummaryEn": "AI Summary",
  "sim.aiSummaryZh": "AI总结",

  "history.title": "回测历史",
  "history.runs": "条记录",
  "history.completed": "已完成",
  "history.failed": "失败",
  "history.return": "收益率",
  "history.performanceMetrics": "绩效指标",
  "history.equityCurve": "权益曲线",
  "history.trades": "交易记录",
  "history.strategyDsl": "策略 DSL",
  "history.copy": "复制",
  "history.loadStrategy": "加载策略",
  "history.loadingReport": "加载报告中...",
  "history.loadFailed": "加载历史失败",
  "history.dslCopied": "DSL 已复制到剪贴板",
  "history.promptLoaded": "策略已加载",
  "history.delete": "删除",
  "history.deleteConfirm": "删除该策略及其相关回测记录？",
  "history.deleteSuccess": "策略已删除",
  "history.deleteFailed": "删除策略失败",
  "history.downloadResults": "结果下载",
  "history.downloadFailed": "下载失败",
  "trade.title": "交易记录",
  "trade.exportCsv": "导出 CSV",
  "trade.timestamp": "时间戳",
  "trade.symbol": "标的",
  "trade.action": "动作",
  "trade.price": "价格",
  "trade.pnl": "盈亏",
  "trade.pnlPct": "盈亏 %",
  "trade.reason": "原因",
  "chart.marketOhlc": "市场开高低收",
  "chart.strategyCurve": "策略曲线",
  "chart.tradeMarker": "交易标记",
  "chart.marketUp": "上涨",
  "chart.marketDown": "下跌",

  "workspace.title": "AI 工作区",
  "workspace.subtitle": "正在处理自然语言策略定义...",
  "workspace.readyTitle": "准备就绪",
  "workspace.readySubtitle": "输入自然语言交易策略并点击运行回测开始。",
  "workspace.artifacts": "产出物",
  "workspace.step.parse": "解析",
  "workspace.step.plan": "计划",
  "workspace.step.data": "数据",
  "workspace.step.backtest": "回测",
  "workspace.step.report": "报告",
  "workspace.step.deploy": "部署",
  "workspace.step.running": "进行中",

  "artifact.title": "产出物",
  "artifact.strategyDsl": "策略 DSL",
  "artifact.backtestReport": "回测报告",
  "artifact.tradesCsv": "交易 CSV",
  "artifact.copied": "已复制",
  "artifact.copiedDesc": "策略 DSL 已复制到剪贴板",
  "artifact.copyFailed": "复制失败",
  "artifact.comingSoon": "功能即将上线",
  "artifact.reportComingSoonDesc": "接入真实后端后即可下载报告。",
  "artifact.csvComingSoonDesc": "接入真实后端后即可下载 CSV。",

  "action.revisePrompt": "修改策略",
  "action.confirmDeploy": "确认部署",

  "deploy.title": "部署策略",
  "deploy.mode": "部署模式",
  "deploy.paper": "模拟交易",
  "deploy.paperDesc": "仅模拟执行",
  "deploy.live": "实盘交易",
  "deploy.liveDesc": "涉及真实资金",
  "deploy.liveWarningTitle": "真实资金风险",
  "deploy.liveWarningDesc": "该策略将使用真实资金执行，请先确认所有参数。",
  "deploy.cancel": "取消",
  "deploy.deploying": "部署中...",
  "deploy.deployTo": "部署到",
  "deploy.success": "策略部署成功！",
  "deploy.failed": "部署失败",
  "deploy.tryAgain": "请重试。",

  "error.backtestFailed": "回测失败",
  "error.retryBacktest": "重试回测",

  "code.title": "策略代码",
  "code.copy": "复制代码",
  "code.copied": "已复制！",

  "common.cancel": "取消",
  "common.save": "保存",
  "common.saving": "保存中...",
  "common.loading": "加载中...",

  "login.login": "登录",
  "login.signUp": "注册",
  "login.createAccount": "创建新账户",
  "login.enterCredentials": "输入凭据以访问平台",
  "login.email": "邮箱",
  "login.password": "密码",
  "login.loading": "加载中...",
  "login.alreadyHaveAccount": "已有账号？去登录",
  "login.noAccount": "没有账号？去注册",
  "login.checkEmail": "请查收邮箱中的确认链接！",
  "login.loggedIn": "登录成功！",
  "login.authFailed": "认证失败，请重试。",
  "login.invalidCredentials": "邮箱或密码错误。",
  "login.emailNotConfirmed": "请先完成邮箱验证后再登录。"
};

const translations: Record<Locale, Record<string, string>> = { en, zh };

const I18nContext = createContext<I18nContextType | undefined>(undefined);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const saved = localStorage.getItem("aipha-locale");
    return saved === "zh" ? "zh" : "en";
  });

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    localStorage.setItem("aipha-locale", newLocale);
  }, []);

  const toggleLocale = useCallback(() => {
    setLocaleState((prev) => {
      const next = prev === "en" ? "zh" : "en";
      localStorage.setItem("aipha-locale", next);
      return next;
    });
  }, []);

  const t = useCallback((key: string): string => translations[locale][key] ?? key, [locale]);

  return <I18nContext.Provider value={{ locale, setLocale, toggleLocale, t }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
