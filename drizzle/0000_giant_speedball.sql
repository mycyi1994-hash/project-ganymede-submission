CREATE TABLE `assets` (
	`symbol` text PRIMARY KEY NOT NULL,
	`market` text NOT NULL,
	`name` text NOT NULL,
	`asset_class` text NOT NULL,
	`stablecoin` integer DEFAULT false NOT NULL,
	`eligible` integer DEFAULT true NOT NULL,
	`circulating_supply_micros` text NOT NULL,
	`custody_supported` integer DEFAULT true NOT NULL,
	`listing_date` text NOT NULL,
	`decimals` integer DEFAULT 8 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assets_market_unique` ON `assets` (`market`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`actor` text NOT NULL,
	`payload_json` text NOT NULL,
	`payload_hash` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_entity_idx` ON `audit_events` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `audit_created_idx` ON `audit_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `engine_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `fills` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`venue_trade_id` text NOT NULL,
	`price_krw` text NOT NULL,
	`units_atomic` text NOT NULL,
	`fee_krw` text DEFAULT '0' NOT NULL,
	`executed_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fills_venue_trade_id_unique` ON `fills` (`venue_trade_id`);--> statement-breakpoint
CREATE INDEX `fills_order_idx` ON `fills` (`order_id`);--> statement-breakpoint
CREATE TABLE `fund_positions` (
	`product_id` text NOT NULL,
	`symbol` text NOT NULL,
	`units_atomic` text DEFAULT '0' NOT NULL,
	`cost_basis_krw` text DEFAULT '0' NOT NULL,
	`market_value_krw` text DEFAULT '0' NOT NULL,
	`last_price_krw` text DEFAULT '0' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`product_id`, `symbol`),
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`symbol`) REFERENCES `assets`(`symbol`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `giwa_settlements` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`payload_hash` text NOT NULL,
	`status` text NOT NULL,
	`tx_hash` text,
	`block_number` text,
	`error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `giwa_entity_action_idx` ON `giwa_settlements` (`entity_type`,`entity_id`,`action`);--> statement-breakpoint
CREATE TABLE `investor_positions` (
	`investor_id` text NOT NULL,
	`product_id` text NOT NULL,
	`shares_micros` text DEFAULT '0' NOT NULL,
	`cost_basis_krw` text DEFAULT '0' NOT NULL,
	`realized_pnl_krw` text DEFAULT '0' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`investor_id`, `product_id`),
	FOREIGN KEY (`investor_id`) REFERENCES `investors`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `investors` (
	`id` text PRIMARY KEY NOT NULL,
	`external_subject` text NOT NULL,
	`email` text,
	`wallet_address` text,
	`kyc_status` text DEFAULT 'unverified' NOT NULL,
	`investor_class` text DEFAULT 'retail' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `investors_external_subject_unique` ON `investors` (`external_subject`);--> statement-breakpoint
CREATE TABLE `market_prices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`symbol` text NOT NULL,
	`price_krw` text NOT NULL,
	`bid_krw` text NOT NULL,
	`ask_krw` text NOT NULL,
	`volume_24h_krw` text NOT NULL,
	`change_24h_bps` integer DEFAULT 0 NOT NULL,
	`source` text NOT NULL,
	`quality` text NOT NULL,
	`as_of` text NOT NULL,
	FOREIGN KEY (`symbol`) REFERENCES `assets`(`symbol`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `market_prices_symbol_asof_idx` ON `market_prices` (`symbol`,`as_of`);--> statement-breakpoint
CREATE INDEX `market_prices_asof_idx` ON `market_prices` (`as_of`);--> statement-breakpoint
CREATE TABLE `nav_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` text NOT NULL,
	`nav_per_share_micros` text NOT NULL,
	`net_asset_value_krw` text NOT NULL,
	`gross_asset_value_krw` text NOT NULL,
	`liabilities_krw` text DEFAULT '0' NOT NULL,
	`shares_outstanding_micros` text NOT NULL,
	`daily_return_bps` integer DEFAULT 0 NOT NULL,
	`tracking_error_bps` integer DEFAULT 0 NOT NULL,
	`quality` text NOT NULL,
	`holdings_hash` text NOT NULL,
	`as_of` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `nav_product_asof_idx` ON `nav_snapshots` (`product_id`,`as_of`);--> statement-breakpoint
CREATE INDEX `nav_asof_idx` ON `nav_snapshots` (`as_of`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`rebalance_run_id` text,
	`product_id` text NOT NULL,
	`symbol` text NOT NULL,
	`side` text NOT NULL,
	`order_type` text NOT NULL,
	`requested_notional_krw` text NOT NULL,
	`requested_units_atomic` text,
	`limit_price_krw` text,
	`status` text NOT NULL,
	`venue` text DEFAULT 'UPBIT' NOT NULL,
	`venue_order_id` text,
	`idempotency_key` text NOT NULL,
	`error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`rebalance_run_id`) REFERENCES `rebalance_runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`symbol`) REFERENCES `assets`(`symbol`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_idempotency_key_unique` ON `orders` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `orders_product_status_idx` ON `orders` (`product_id`,`status`);--> statement-breakpoint
CREATE INDEX `orders_rebalance_idx` ON `orders` (`rebalance_run_id`);--> statement-breakpoint
CREATE TABLE `price_candles` (
	`symbol` text NOT NULL,
	`candle_date` text NOT NULL,
	`open_krw` text NOT NULL,
	`high_krw` text NOT NULL,
	`low_krw` text NOT NULL,
	`close_krw` text NOT NULL,
	`volume_krw` text NOT NULL,
	`source` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`symbol`, `candle_date`),
	FOREIGN KEY (`symbol`) REFERENCES `assets`(`symbol`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`ticker` text NOT NULL,
	`name` text NOT NULL,
	`strategy_style` text NOT NULL,
	`category` text NOT NULL,
	`status` text DEFAULT 'operational' NOT NULL,
	`benchmark` text NOT NULL,
	`expense_ratio_bps` integer NOT NULL,
	`rebalance_cadence` text NOT NULL,
	`base_currency` text DEFAULT 'KRW' NOT NULL,
	`shares_outstanding_micros` text DEFAULT '0' NOT NULL,
	`cash_balance_krw` text DEFAULT '0' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_slug_unique` ON `products` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `products_ticker_unique` ON `products` (`ticker`);--> statement-breakpoint
CREATE TABLE `rebalance_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`strategy_style` text NOT NULL,
	`status` text NOT NULL,
	`trigger` text NOT NULL,
	`target_json` text NOT NULL,
	`turnover_bps` integer DEFAULT 0 NOT NULL,
	`scheduled_for` text NOT NULL,
	`started_at` text,
	`completed_at` text,
	`error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `rebalance_product_status_idx` ON `rebalance_runs` (`product_id`,`status`);--> statement-breakpoint
CREATE TABLE `redemptions` (
	`id` text PRIMARY KEY NOT NULL,
	`investor_id` text NOT NULL,
	`product_id` text NOT NULL,
	`requested_shares_micros` text NOT NULL,
	`proceeds_krw` text DEFAULT '0' NOT NULL,
	`status` text NOT NULL,
	`client_reference` text NOT NULL,
	`giwa_tx_hash` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`settled_at` text,
	FOREIGN KEY (`investor_id`) REFERENCES `investors`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `redemptions_client_reference_unique` ON `redemptions` (`client_reference`);--> statement-breakpoint
CREATE TABLE `strategy_configs` (
	`product_id` text PRIMARY KEY NOT NULL,
	`style` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`max_weight_bps` integer NOT NULL,
	`min_weight_bps` integer NOT NULL,
	`cash_buffer_bps` integer DEFAULT 100 NOT NULL,
	`turnover_limit_bps` integer DEFAULT 2500 NOT NULL,
	`minimum_volume_krw` text NOT NULL,
	`minimum_history_days` integer DEFAULT 180 NOT NULL,
	`parameters_json` text NOT NULL,
	`approved_by` text DEFAULT 'SYSTEM' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `strategy_signals` (
	`product_id` text NOT NULL,
	`symbol` text NOT NULL,
	`momentum_score_micros` integer NOT NULL,
	`volatility_score_micros` integer NOT NULL,
	`liquidity_score_micros` integer NOT NULL,
	`conviction_score_micros` integer NOT NULL,
	`as_of` text NOT NULL,
	PRIMARY KEY(`product_id`, `symbol`, `as_of`),
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`symbol`) REFERENCES `assets`(`symbol`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`investor_id` text NOT NULL,
	`product_id` text NOT NULL,
	`amount_krw` text NOT NULL,
	`expected_shares_micros` text NOT NULL,
	`issued_shares_micros` text DEFAULT '0' NOT NULL,
	`status` text NOT NULL,
	`client_reference` text NOT NULL,
	`giwa_tx_hash` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`settled_at` text,
	FOREIGN KEY (`investor_id`) REFERENCES `investors`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscriptions_client_reference_unique` ON `subscriptions` (`client_reference`);--> statement-breakpoint
CREATE TABLE `target_allocations` (
	`product_id` text NOT NULL,
	`symbol` text NOT NULL,
	`target_weight_bps` integer NOT NULL,
	`rationale` text NOT NULL,
	`effective_at` text NOT NULL,
	`strategy_version` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`product_id`, `symbol`, `effective_at`),
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`symbol`) REFERENCES `assets`(`symbol`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `worker_leases` (
	`name` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`expires_at` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
