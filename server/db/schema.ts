import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

// Every table carries user_id (decision #1), even though there is one user.

export const SOURCES = ['trakt', 'simkl', 'mal', 'tmdb', 'anilist'] as const
export type Source = (typeof SOURCES)[number]

export const SOURCE_STATUSES = ['ok', 'rate_limited', 'auth_expired', 'error'] as const
export type SourceStatus = (typeof SOURCE_STATUSES)[number]

const createdAt = () => integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`)
const updatedAt = () => integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`).$onUpdate(() => new Date())

// One row per source. Token columns stay null for TMDB and AniList, which only use the row for rate limit state.
export const sourceAccounts = sqliteTable('source_accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  source: text('source', { enum: SOURCES }).notNull(),
  accessTokenEnc: text('access_token_enc'),
  refreshTokenEnc: text('refresh_token_enc'),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
  blockedUntil: integer('blocked_until', { mode: 'timestamp_ms' }),
  lastStatus: text('last_status', { enum: SOURCE_STATUSES }),
  lastError: text('last_error'),
  lastFetchAt: integer('last_fetch_at', { mode: 'timestamp_ms' }),
  createdAt: createdAt(),
  updatedAt: updatedAt()
}, t => [
  uniqueIndex('source_accounts_user_source').on(t.userId, t.source)
])

export const mappings = sqliteTable('mappings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  traktId: integer('trakt_id'),
  // For links to trakt.tv; Trakt URLs use the slug.
  traktSlug: text('trakt_slug'),
  simklId: integer('simkl_id'),
  malId: integer('mal_id'),
  tmdbId: integer('tmdb_id'),
  anilistId: integer('anilist_id'),
  kind: text('kind', { enum: ['show', 'anime'] }).notNull(),
  status: text('status', { enum: ['auto', 'confirmed', 'rejected'] }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt()
}, t => [
  index('mappings_user_trakt').on(t.userId, t.traktId),
  index('mappings_user_simkl').on(t.userId, t.simklId),
  index('mappings_user_mal').on(t.userId, t.malId)
])

// Anime only: one row per anime entry (Simkl and MAL list each season or cour separately), placed in a
// Trakt season with episode_offset: Trakt episode N of trakt_season is episode N - episode_offset of the
// entry. One Trakt season can span several entries. trakt_season is null while the entry is not placed
// in a Trakt show yet (for example an anime that is only on Simkl and MAL).
export const mappingSeasons = sqliteTable('mapping_seasons', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  mappingId: integer('mapping_id').notNull().references(() => mappings.id, { onDelete: 'cascade' }),
  traktSeason: integer('trakt_season'),
  malId: integer('mal_id'),
  anilistId: integer('anilist_id'),
  simklId: integer('simkl_id'),
  episodeOffset: integer('episode_offset').notNull().default(0),
  episodeCount: integer('episode_count'),
  createdAt: createdAt(),
  updatedAt: updatedAt()
}, t => [
  uniqueIndex('mapping_seasons_mapping_season_offset').on(t.mappingId, t.traktSeason, t.episodeOffset),
  // An anime entry belongs to one show only.
  uniqueIndex('mapping_seasons_user_mal').on(t.userId, t.malId),
  uniqueIndex('mapping_seasons_user_simkl').on(t.userId, t.simklId)
])

export const rejectedCandidates = sqliteTable('rejected_candidates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  source: text('source', { enum: SOURCES }).notNull(),
  sourceItemId: text('source_item_id').notNull(),
  candidateSource: text('candidate_source', { enum: SOURCES }).notNull(),
  candidateId: text('candidate_id').notNull(),
  createdAt: createdAt()
}, t => [
  uniqueIndex('rejected_candidates_unique').on(t.userId, t.source, t.sourceItemId, t.candidateSource, t.candidateId)
])

// Differences on Up Next you accepted, stored with the exact positions the sources showed (the row's
// signature). The flag comes back as soon as any source moves, because the signature no longer matches.
export const acceptedDifferences = sqliteTable('accepted_differences', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  rowKey: text('row_key').notNull(),
  signature: text('signature').notNull(),
  createdAt: createdAt()
}, t => [
  uniqueIndex('accepted_differences_user_row').on(t.userId, t.rowKey)
])

// Sequels on Coming back you dismissed (#66), by their MAL ID. They stay out of the section until undone.
export const dismissedSequels = sqliteTable('dismissed_sequels', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  malId: integer('mal_id').notNull(),
  createdAt: createdAt()
}, t => [
  uniqueIndex('dismissed_sequels_user_mal').on(t.userId, t.malId)
])

export const metadataCache = sqliteTable('metadata_cache', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  provider: text('provider', { enum: ['tmdb', 'anilist', 'trakt'] }).notNull(),
  externalId: text('external_id').notNull(),
  json: text('json', { mode: 'json' }).notNull(),
  fetchedAt: integer('fetched_at', { mode: 'timestamp_ms' }).notNull()
}, t => [
  uniqueIndex('metadata_cache_unique').on(t.userId, t.provider, t.externalId)
])

// Last successful response per source and request key, served stale when the source is blocked or failing.
export const fetchCache = sqliteTable('fetch_cache', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  source: text('source', { enum: SOURCES }).notNull(),
  key: text('key').notNull().default(''),
  json: text('json', { mode: 'json' }).notNull(),
  fetchedAt: integer('fetched_at', { mode: 'timestamp_ms' }).notNull()
}, t => [
  uniqueIndex('fetch_cache_unique').on(t.userId, t.source, t.key)
])

// Pending OAuth flows: one-time `state` plus the PKCE verifier (Trakt, MAL). Rows are deleted on use or expiry.
export const oauthStates = sqliteTable('oauth_states', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  source: text('source', { enum: SOURCES }).notNull(),
  state: text('state').notNull(),
  codeVerifier: text('code_verifier'),
  createdAt: createdAt()
}, t => [
  uniqueIndex('oauth_states_state').on(t.state)
])

export const writeLog = sqliteTable('write_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  source: text('source', { enum: SOURCES }).notNull(),
  item: text('item', { mode: 'json' }).notNull(),
  action: text('action').notNull(),
  result: text('result', { enum: ['ok', 'error'] }).notNull(),
  error: text('error'),
  at: integer('at', { mode: 'timestamp_ms' }).notNull()
}, t => [
  index('write_log_user_at').on(t.userId, t.at)
])
