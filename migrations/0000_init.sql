CREATE TABLE `catalog` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`data` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `catalog_sources` (
	`catalog_id` text NOT NULL,
	`source_id` integer NOT NULL,
	`filter` text,
	PRIMARY KEY(`catalog_id`, `source_id`)
);
--> statement-breakpoint
CREATE INDEX `catalog_sources_source` ON `catalog_sources` (`source_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer NOT NULL,
	`catalog_id` text,
	`kind` text NOT NULL,
	`detected_at` integer NOT NULL,
	`published_at` integer,
	`effective_date` text,
	`status` text NOT NULL,
	`confidence` real,
	`title` text NOT NULL,
	`quote` text,
	`quote_url` text NOT NULL,
	`before_text` text,
	`after_text` text,
	`note` text,
	`applies_when` text,
	`dedupe_key` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_dedupe_key_unique` ON `events` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `events_status_detected` ON `events` (`status`,`detected_at`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`source_id` integer,
	`event_id` integer,
	`run_after` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	`last_error` text,
	`payload` text,
	`dedupe_key` text,
	`parked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_dedupe_key_unique` ON `jobs` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `jobs_run_after` ON `jobs` (`run_after`);--> statement-breakpoint
CREATE TABLE `robots` (
	`host` text PRIMARY KEY NOT NULL,
	`body` text NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer NOT NULL,
	`fetched_at` integer NOT NULL,
	`http_status` integer NOT NULL,
	`sha256` text,
	`size` integer,
	`r2_key` text
);
--> statement-breakpoint
CREATE INDEX `snapshots_source_fetched` ON `snapshots` (`source_id`,`fetched_at`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`url` text NOT NULL,
	`selector` text,
	`config` text DEFAULT '{}' NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`etag` text,
	`last_modified` text,
	`next_poll_at` integer NOT NULL,
	`fail_count` integer DEFAULT 0 NOT NULL,
	`last_ok_at` integer,
	`last_sha` text,
	`last_state` text,
	`block_strikes` integer DEFAULT 0 NOT NULL,
	`last_error` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sources_kind_key` ON `sources` (`kind`,`key`);--> statement-breakpoint
CREATE INDEX `sources_next_poll_at` ON `sources` (`next_poll_at`);