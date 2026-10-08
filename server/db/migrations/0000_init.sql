CREATE TABLE `fetch_cache` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`source` text NOT NULL,
	`key` text DEFAULT '' NOT NULL,
	`json` text NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fetch_cache_unique` ON `fetch_cache` (`user_id`,`source`,`key`);--> statement-breakpoint
CREATE TABLE `mapping_seasons` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`mapping_id` integer NOT NULL,
	`trakt_season` integer NOT NULL,
	`mal_id` integer,
	`anilist_id` integer,
	`episode_offset` integer DEFAULT 0 NOT NULL,
	`episode_count` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`mapping_id`) REFERENCES `mappings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mapping_seasons_mapping_season_offset` ON `mapping_seasons` (`mapping_id`,`trakt_season`,`episode_offset`);--> statement-breakpoint
CREATE TABLE `mappings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`trakt_id` integer,
	`simkl_id` integer,
	`mal_id` integer,
	`tmdb_id` integer,
	`anilist_id` integer,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mappings_user_trakt` ON `mappings` (`user_id`,`trakt_id`);--> statement-breakpoint
CREATE INDEX `mappings_user_simkl` ON `mappings` (`user_id`,`simkl_id`);--> statement-breakpoint
CREATE INDEX `mappings_user_mal` ON `mappings` (`user_id`,`mal_id`);--> statement-breakpoint
CREATE TABLE `metadata_cache` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`json` text NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `metadata_cache_unique` ON `metadata_cache` (`user_id`,`provider`,`external_id`);--> statement-breakpoint
CREATE TABLE `rejected_candidates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`source` text NOT NULL,
	`source_item_id` text NOT NULL,
	`candidate_source` text NOT NULL,
	`candidate_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rejected_candidates_unique` ON `rejected_candidates` (`user_id`,`source`,`source_item_id`,`candidate_source`,`candidate_id`);--> statement-breakpoint
CREATE TABLE `source_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`source` text NOT NULL,
	`access_token_enc` text,
	`refresh_token_enc` text,
	`expires_at` integer,
	`blocked_until` integer,
	`last_status` text,
	`last_error` text,
	`last_fetch_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_accounts_user_source` ON `source_accounts` (`user_id`,`source`);--> statement-breakpoint
CREATE TABLE `write_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`source` text NOT NULL,
	`item` text NOT NULL,
	`action` text NOT NULL,
	`result` text NOT NULL,
	`error` text,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `write_log_user_at` ON `write_log` (`user_id`,`at`);