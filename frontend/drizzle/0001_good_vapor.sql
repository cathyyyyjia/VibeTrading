CREATE TABLE `backtest_runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`runId` varchar(32) NOT NULL,
	`userId` int,
	`prompt` text NOT NULL,
	`options` json,
	`state` enum('idle','running','completed','failed') NOT NULL DEFAULT 'idle',
	`dsl` text,
	`kpis` json,
	`equity` json,
	`seed` int,
	`shouldFail` int DEFAULT 0,
	`failStep` int DEFAULT 0,
	`progress` int DEFAULT 0,
	`steps` json,
	`deployId` varchar(64),
	`deployMode` enum('paper','live'),
	`deployStatus` enum('queued','ok'),
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`completedAt` timestamp,
	CONSTRAINT `backtest_runs_id` PRIMARY KEY(`id`),
	CONSTRAINT `backtest_runs_runId_unique` UNIQUE(`runId`)
);
--> statement-breakpoint
CREATE TABLE `backtest_trades` (
	`id` int AUTO_INCREMENT NOT NULL,
	`runId` varchar(32) NOT NULL,
	`tradeTimestamp` varchar(64) NOT NULL,
	`symbol` varchar(32) NOT NULL,
	`action` enum('BUY','SELL') NOT NULL,
	`price` float NOT NULL,
	`pnl` float,
	`sortOrder` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `backtest_trades_id` PRIMARY KEY(`id`)
);
