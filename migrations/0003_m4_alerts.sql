CREATE TABLE `alerts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`event_id` integer NOT NULL,
	`dep_id` integer NOT NULL,
	`channel` text NOT NULL,
	`status` text NOT NULL,
	`sent_at` integer,
	`feedback` text,
	`created_at` integer NOT NULL,
	`match` text NOT NULL,
	`because` text NOT NULL,
	`held` text,
	`claimed_at` integer,
	`emailed_at` integer,
	`slack_at` integer,
	`slack_try_at` integer,
	`digest_at` integer,
	`feedback_at` integer,
	`error` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `alerts_user_event` ON `alerts` (`user_id`,`event_id`);--> statement-breakpoint
CREATE INDEX `alerts_user_status` ON `alerts` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `alerts_event` ON `alerts` (`event_id`);--> statement-breakpoint
CREATE TABLE `channels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`kind` text NOT NULL,
	`webhook_url_enc` text NOT NULL,
	`verified_at` integer,
	`hint` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_error` text
);
--> statement-breakpoint
CREATE INDEX `channels_user` ON `channels` (`user_id`);--> statement-breakpoint
ALTER TABLE `users` ADD `email_immediate` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `last_digest_at` integer;