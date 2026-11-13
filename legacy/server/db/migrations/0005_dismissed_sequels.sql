CREATE TABLE `dismissed_sequels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`mal_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dismissed_sequels_user_mal` ON `dismissed_sequels` (`user_id`,`mal_id`);