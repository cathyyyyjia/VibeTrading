CREATE TABLE `ai_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`strategyId` varchar(64) NOT NULL,
	`runId` varchar(64) NOT NULL,
	`userId` int,
	`lastCheckTime` timestamp,
	`aiStatus` enum('MONITORING','TRIGGERED','EXECUTING','COMPLETED','FAILED') NOT NULL DEFAULT 'MONITORING',
	`indicatorsSnapshot` json,
	`stageLogs` json,
	`runtimeLogs` json,
	`backtestRunId` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ai_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `market_data` (
	`id` int AUTO_INCREMENT NOT NULL,
	`symbol` varchar(16) NOT NULL,
	`timeframe` varchar(8) NOT NULL DEFAULT '1m',
	`t` bigint NOT NULL,
	`o` double NOT NULL,
	`h` double NOT NULL,
	`l` double NOT NULL,
	`c` double NOT NULL,
	`v` bigint NOT NULL,
	`vwap` double,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `market_data_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_symbol_timeframe_t` UNIQUE(`symbol`,`timeframe`,`t`)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`orderId` varchar(64) NOT NULL,
	`accountId` varchar(64) NOT NULL,
	`strategyId` varchar(64),
	`symbol` varchar(32) NOT NULL,
	`side` enum('BUY','SELL') NOT NULL,
	`orderType` enum('MARKET','LIMIT','MOC') NOT NULL DEFAULT 'MARKET',
	`orderStatus` enum('PENDING','FILLED','REJECTED','CANCELLED') NOT NULL DEFAULT 'PENDING',
	`requestQty` double NOT NULL,
	`filledQty` double,
	`filledPrice` double,
	`commission` double DEFAULT 0,
	`errorMessage` text,
	`filledAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `orders_orderId_unique` UNIQUE(`orderId`)
);
--> statement-breakpoint
CREATE TABLE `portfolios` (
	`id` int AUTO_INCREMENT NOT NULL,
	`accountId` varchar(64) NOT NULL,
	`userId` int,
	`accountType` enum('PAPER','LIVE') NOT NULL DEFAULT 'PAPER',
	`brokerProvider` varchar(64) DEFAULT 'MOCK',
	`currency` varchar(8) NOT NULL DEFAULT 'USD',
	`accountStatus` enum('ACTIVE','INACTIVE','SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
	`cash` double NOT NULL DEFAULT 10000,
	`buyingPower` double NOT NULL DEFAULT 20000,
	`equity` double NOT NULL DEFAULT 10000,
	`initialDeposit` double NOT NULL DEFAULT 10000,
	`totalPnl` double NOT NULL DEFAULT 0,
	`dailyPnl` double NOT NULL DEFAULT 0,
	`pnlPct` double NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `portfolios_id` PRIMARY KEY(`id`),
	CONSTRAINT `portfolios_accountId_unique` UNIQUE(`accountId`)
);
--> statement-breakpoint
CREATE TABLE `positions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`accountId` varchar(64) NOT NULL,
	`strategyId` varchar(64),
	`symbol` varchar(32) NOT NULL,
	`qty` double NOT NULL,
	`avgPrice` double NOT NULL,
	`currentPrice` double,
	`marketValue` double,
	`unrealizedPnl` double,
	`unrealizedPnlPct` double,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `positions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `strategies` (
	`id` int AUTO_INCREMENT NOT NULL,
	`strategyId` varchar(64) NOT NULL,
	`userId` int,
	`name` varchar(256) NOT NULL,
	`prompt` text NOT NULL,
	`status` enum('DRAFT','BACKTESTING','BACKTESTED','PENDING_DEPLOY','LIVE','ARCHIVED') NOT NULL DEFAULT 'DRAFT',
	`isFrozen` boolean NOT NULL DEFAULT false,
	`version` varchar(16) NOT NULL DEFAULT '1.0',
	`parentId` varchar(64),
	`atomLayer` json,
	`timeframeLayer` json,
	`signalLayer` json,
	`logicLayer` json,
	`actionLayer` json,
	`deployedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `strategies_id` PRIMARY KEY(`id`),
	CONSTRAINT `strategies_strategyId_unique` UNIQUE(`strategyId`)
);
--> statement-breakpoint
ALTER TABLE `backtest_runs` MODIFY COLUMN `runId` varchar(64) NOT NULL;--> statement-breakpoint
ALTER TABLE `backtest_trades` MODIFY COLUMN `runId` varchar(64) NOT NULL;--> statement-breakpoint
ALTER TABLE `backtest_trades` MODIFY COLUMN `price` double NOT NULL;--> statement-breakpoint
ALTER TABLE `backtest_trades` MODIFY COLUMN `pnl` double;--> statement-breakpoint
ALTER TABLE `backtest_runs` ADD `strategyId` varchar(64);--> statement-breakpoint
ALTER TABLE `backtest_runs` ADD `totalReturn` double;--> statement-breakpoint
ALTER TABLE `backtest_runs` ADD `annualizedReturn` double;--> statement-breakpoint
ALTER TABLE `backtest_runs` ADD `sharpeRatio` double;--> statement-breakpoint
ALTER TABLE `backtest_runs` ADD `maxDrawdown` double;--> statement-breakpoint
ALTER TABLE `backtest_runs` ADD `winRate` double;--> statement-breakpoint
ALTER TABLE `backtest_runs` ADD `totalTrades` int;--> statement-breakpoint
ALTER TABLE `backtest_runs` ADD `regimeAnalysis` text;--> statement-breakpoint
ALTER TABLE `backtest_runs` ADD `signalHeatmap` json;--> statement-breakpoint
ALTER TABLE `backtest_runs` ADD `dslSnapshot` json;--> statement-breakpoint
ALTER TABLE `backtest_trades` ADD `tradeId` varchar(64);--> statement-breakpoint
ALTER TABLE `backtest_trades` ADD `entryTime` varchar(64);--> statement-breakpoint
ALTER TABLE `backtest_trades` ADD `exitTime` varchar(64);--> statement-breakpoint
ALTER TABLE `backtest_trades` ADD `pnlPct` double;--> statement-breakpoint
ALTER TABLE `backtest_trades` ADD `reason` text;--> statement-breakpoint
CREATE INDEX `idx_symbol_t` ON `market_data` (`symbol`,`t`);