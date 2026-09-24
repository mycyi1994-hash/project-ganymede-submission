-- Demo investing in USTX with demo dollars. No real money and no on-chain shares:
-- an account is a private browser session (the paper session cookie, hashed).
CREATE TABLE IF NOT EXISTS `demo_accounts` (
	`subject` text PRIMARY KEY NOT NULL,
	`cash_micros` integer NOT NULL,
	`shares_micros` integer DEFAULT 0 NOT NULL,
	`cost_micros` integer DEFAULT 0 NOT NULL,
	`orders_count` integer DEFAULT 0 NOT NULL,
	`last_order_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `demo_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`subject` text NOT NULL,
	`side` text NOT NULL,
	`usd_micros` integer NOT NULL,
	`shares_micros` integer NOT NULL,
	`nav_micros` integer NOT NULL,
	`nav_effective_at` text NOT NULL,
	`nav_holdings_hash` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `demo_orders_subject_created` ON `demo_orders` (`subject`,`created_at`);
--> statement-breakpoint
-- Order attempts per UTC day across all accounts, so demo traffic cannot use up
-- the database's daily write budget that NAV publication depends on.
CREATE TABLE IF NOT EXISTS `demo_daily` (
	`day` text PRIMARY KEY NOT NULL,
	`orders` integer DEFAULT 0 NOT NULL
);
