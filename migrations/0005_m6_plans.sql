CREATE TABLE `stripe_events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `team_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` integer NOT NULL,
	`email` text NOT NULL,
	`user_id` integer,
	`invited_at` integer NOT NULL,
	`joined_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_members_owner_email` ON `team_members` (`owner_id`,`email`);--> statement-breakpoint
CREATE INDEX `team_members_user` ON `team_members` (`user_id`);--> statement-breakpoint
CREATE INDEX `team_members_email` ON `team_members` (`email`);--> statement-breakpoint
ALTER TABLE `users` ADD `stripe_subscription_id` text;--> statement-breakpoint
ALTER TABLE `users` ADD `plan_status` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `plan_interval` text;--> statement-breakpoint
ALTER TABLE `users` ADD `plan_period_end` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `cancel_at_period_end` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `plan_event_at` integer;