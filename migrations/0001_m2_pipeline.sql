CREATE TABLE `llm_calls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`purpose` text NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`cache_write_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd` real NOT NULL,
	`event_id` integer,
	`outcome` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `llm_calls_created` ON `llm_calls` (`created_at`);--> statement-breakpoint
ALTER TABLE `events` ADD `source_keys` text;--> statement-breakpoint
ALTER TABLE `events` ADD `classification` text;--> statement-breakpoint
ALTER TABLE `events` ADD `review_reason` text;--> statement-breakpoint
ALTER TABLE `events` ADD `quote_found` integer;--> statement-breakpoint
ALTER TABLE `events` ADD `duplicate_of` integer;