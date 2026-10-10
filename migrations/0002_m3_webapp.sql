CREATE TABLE `catalog_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer,
	`text` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dep_sources` (
	`dep_id` integer NOT NULL,
	`source_id` integer NOT NULL,
	PRIMARY KEY(`dep_id`, `source_id`)
);
--> statement-breakpoint
CREATE INDEX `dep_sources_source` ON `dep_sources` (`source_id`);--> statement-breakpoint
CREATE TABLE `deps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`catalog_id` text,
	`ecosystem` text,
	`package` text,
	`version_spec` text,
	`eol_product` text,
	`eol_cycle` text,
	`profile` text DEFAULT '{}' NOT NULL,
	`muted_until` integer,
	`origin` text NOT NULL,
	`dep_key` text NOT NULL,
	`rank` integer,
	`found_in` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deps_project_key` ON `deps` (`project_id`,`dep_key`);--> statement-breakpoint
CREATE TABLE `imports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`repo` text NOT NULL,
	`status` text NOT NULL,
	`step` text NOT NULL,
	`state` text NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `imports_project` ON `imports` (`project_id`);--> statement-breakpoint
CREATE TABLE `magic_links` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`user_id` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`repo_full_name` text,
	`github_installation_id` integer,
	`default_profile` text DEFAULT '{}' NOT NULL,
	`last_import_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `projects_user` ON `projects` (`user_id`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sessions_user` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`github_id` integer,
	`name` text,
	`plan` text DEFAULT 'free' NOT NULL,
	`stripe_customer_id` text,
	`digest_day` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_github_id_unique` ON `users` (`github_id`);