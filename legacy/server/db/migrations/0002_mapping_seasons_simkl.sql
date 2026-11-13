PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_mapping_seasons` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`mapping_id` integer NOT NULL,
	`trakt_season` integer,
	`mal_id` integer,
	`anilist_id` integer,
	`simkl_id` integer,
	`episode_offset` integer DEFAULT 0 NOT NULL,
	`episode_count` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`mapping_id`) REFERENCES `mappings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_mapping_seasons`("id", "user_id", "mapping_id", "trakt_season", "mal_id", "anilist_id", "simkl_id", "episode_offset", "episode_count", "created_at", "updated_at") SELECT "id", "user_id", "mapping_id", "trakt_season", "mal_id", "anilist_id", NULL, "episode_offset", "episode_count", "created_at", "updated_at" FROM `mapping_seasons`;--> statement-breakpoint
DROP TABLE `mapping_seasons`;--> statement-breakpoint
ALTER TABLE `__new_mapping_seasons` RENAME TO `mapping_seasons`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `mapping_seasons_mapping_season_offset` ON `mapping_seasons` (`mapping_id`,`trakt_season`,`episode_offset`);--> statement-breakpoint
CREATE UNIQUE INDEX `mapping_seasons_user_mal` ON `mapping_seasons` (`user_id`,`mal_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `mapping_seasons_user_simkl` ON `mapping_seasons` (`user_id`,`simkl_id`);