CREATE TABLE `github_installations` (
	`id` integer PRIMARY KEY NOT NULL,
	`account` text NOT NULL,
	`token_enc` text,
	`token_expires_at` integer,
	`suspended_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
