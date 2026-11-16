CREATE TABLE `movie_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`trakt_id` integer,
	`trakt_slug` text,
	`tmdb_id` integer,
	`imdb_id` text,
	`simkl_id` integer,
	`mal_id` integer,
	`title` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `movie_links_user_trakt` ON `movie_links` (`user_id`,`trakt_id`);--> statement-breakpoint
CREATE INDEX `movie_links_user_mal` ON `movie_links` (`user_id`,`mal_id`);