CREATE TABLE `accepted_differences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`row_key` text NOT NULL,
	`signature` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accepted_differences_user_row` ON `accepted_differences` (`user_id`,`row_key`);