# Tsuzuku app (Flutter)

The Flutter app for Android, Windows, Linux and web (#108, phase 3). It talks only to the Tsuzuku server (`../backend/`, plain Nitro), through the contract in `../api/openapi.yaml`. It is the only UI: the Vue UI it was ported from ("legacy" below and in code comments) was removed in #108 step 4.3; its last commit is `7789437`. Shared rules, layout and docs are in the root `CLAUDE.md` and `../docs/`. Run every command below from this folder.

App id `com.owaisahmed.tsuzuku` (Android `applicationId`, Linux `APPLICATION_ID`). It never changes: a new id is a new app that does not update the old one.

## Tool chain

`flutter` (stable) and `dart` only. No npm, vp or other JS tooling in this folder.

- Packages: `flutter pub add <pkg>` / `flutter pub add --dev <pkg>` / `flutter pub remove <pkg>`. Commit `pubspec.lock`.
- Before committing: `dart format lib test tool`, `flutter analyze`, `flutter test`. All three must be clean.
- Run: `flutter run -d linux` (on this Wayland compositor: `env GDK_BACKEND=x11 flutter run -d linux`). The debug run shares the installed app's storage (same app id), so a plain run talks to the server the installed app uses, writes included. Against the local demo: add `--dart-define=TSUZUKU_DEV_SERVER=http://localhost:3000` (debug builds only; nothing is stored, the title shows the server); web with `flutter run -d web-server --web-port 8080`, then open `http://localhost:8080` in Firefox (no Chrome here). On Android: `flutter run -d <device>` once the Android SDK is set up (`flutter doctor`).
- Builds: `flutter build linux`, `flutter build web`, `flutter build apk`, `flutter build windows` (on Windows). Local release APKs are signed with the debug key; only CI signs with the release key.
- Icons: Solid Glass's forward tile with 続 and a "to be continued" dot. SVG masters in `assets/icon/src/` (続 is outlines from Noto Sans CJK JP Bold, OFL, so it renders the same everywhere); the PNGs are rendered from them with `rsvg-convert` (`icon-512.png` the bare tile, `adaptive-foreground.png` the tile in Android's safe zone, `icon-maskable-512.png` padded on #0d0d0d, `logo.png` / `logo-light.png` 128 px for the header's `AppTitle`). After changing them: `dart run flutter_launcher_icons`, then copy the padded maskable PNGs over `web/icons/Icon-maskable-*.png` (the generator would crop the bare tile).

## API client

`lib/api/` is generated from the contract by [swagger_parser](https://pub.dev/packages/swagger_parser) (plain Dio client, plain DTOs, no build_runner). Never edit it by hand.

- Regenerate after any change to `../api/openapi.yaml`: `dart run tool/generate_api.dart`. CI runs it with `--check` and fails when `lib/api/` is out of date.
- `tool/generate_api.dart` feeds the generator a normalized copy of the contract (zod's `anyOf` with null becomes a nullable type, `additionalProperties: false` is dropped so additive server changes don't break older apps, untyped literals get a type). The contract itself stays as the server's contract check (`vp run check:api`) needs it.
- `TsuzukuApi.apiVersion` is the contract's `info.version`, built into the app. A different `apiVersion` from `/api/health` shows the update banner.
- `test/fixtures_test.dart` replays the golden fixtures (`../api/fixtures/`) through the generated client: every recorded read must decode.

## Server and Cloudflare Access

- Native: the first run asks for the server URL and the Access service token (`CF-Access-Client-Id`, `CF-Access-Client-Secret`), calls `/api/sources/status` with them, and only then stores them in `flutter_secure_storage`. Settings → Server changes them. Empty token fields are allowed for a server without Access (the local demo).
- Web: served by the server itself; same origin, relative URLs, the browser's Access cookie, no first-run screen.
- A 403, or a redirect to `*.cloudflareaccess.com` instead of JSON, shows the "token refused" screen (`lib/screens/access_rejected_screen.dart`). Native Dio does not follow redirects, so the redirect stays visible.
- Never log, print or show the client secret. Error messages never include request headers.

## Releases

`.github/workflows/app-release.yml` runs on a tag `app-vX.Y.Z` (tags only, never branches or PRs) and publishes a GitHub Release. The tag must equal `version:` in `pubspec.yaml`, so bump that first. The build number there is ignored: the Android versionCode is X*1000000 + Y*1000 + Z. Pushing a tag publishes a public Release: ask first.

- Release files (fixed names; the in-app updater, step 3.3, looks for them): `tsuzuku.apk`, `tsuzuku-setup.exe` + `.sig`, `tsuzuku-x86_64.AppImage` + `.sig`. The web build is a workflow artifact `tsuzuku-web-X.Y.Z`, not a Release file; the server image builds its own from `app/` (`../backend/Dockerfile`).
- `.sig`: raw ed25519 signature of the whole file (64 bytes, base64, one line). Public key: `packaging/update-signing-key.pub.pem` (the raw 32-byte key is the last 32 bytes of its DER). CI verifies every signature against it.
- Android: release keystore (PKCS12, alias `tsuzuku`) from Actions secrets, read by `android/app/build.gradle.kts` from `TSUZUKU_KEYSTORE` / `TSUZUKU_KEYSTORE_PASSWORD`. CI fails unless the APK's signer matches `android/release-cert.sha256`. Never change the key: a new key means the APK no longer installs over the old app.
- Windows: Inno Setup, `packaging/windows/tsuzuku.iss`, per user (`%LOCALAPPDATA%\Programs\Tsuzuku`, no UAC). Its `AppId` never changes.
- Linux: `packaging/linux/build-appimage.sh` packs the release bundle with `appimagetool` (pinned version and checksum in the workflow).
- Secrets (Actions, also in the password manager): `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `UPDATE_SIGNING_KEY`. Never print them. No `--dart-define`: no server URL or token in any build.

## In-app updates

`lib/update/` (#108, step 3.3; ported from Befikr's `useUpdate.ts` and `Updater.kt`). Separate from the `apiVersion` banner.

- Check: GitHub `/releases` of `oowais/tsuzuku`, newest `app-vX.Y.Z` tag (never `releases/latest`, so backend releases don't count), at most once a day or on "Check for updates", result kept in `shared_preferences`. A release counts only once this platform's file (desktop: plus its `.sig`) is attached; until then "being built", rechecked every 5 min and on resume. GitHub calls use their own Dio: no Access header ever goes there. Web never checks.
- Android: channel `tsuzuku/updater` (`MainActivity.kt`, `Updater.kt`): download with progress, system installer, opens "Install unknown apps" when not allowed. Needs the release signing key to install over the old app.
- Windows: downloads `tsuzuku-setup.exe` and `.sig` to the app support folder, verifies ed25519 against `updatePublicKey` (`lib/update/signature.dart`, a test checks it equals `packaging/update-signing-key.pub.pem`), runs it with `/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /LAUNCH=1 /LOG=…` and quits; `/LAUNCH=1` makes the installer start the new version. The next start compares versions: still old means failed (error with the log tail, installer kept, "Try again"); new means the installer and log are deleted.
- Linux: only "Version X is available"; Shelly replaces the AppImage, the app never touches it.
- What's new: `tool/whats_new.dart X.Y.Z` (CI, every build job) writes `assets/whats_new.json` from commit subjects under `app/` per `app-v*` tag, last 10 releases. The repo keeps `[]`; don't commit a generated one. Shown once on the first start of a newer version; Settings → "What's new" shows all. The Release body uses the same commits.

## Up Next

`lib/up_next/`. The write buttons (mark watched, accept/undo, start next season, a Coming back sequel on a card) go through `UpNextActions`; `UpNextView` builds them when it gets an `api` (without one the buttons show, disabled).

- Each source keeps its own progress: when the sources differ, every source's next episode is shown on its own line, never merged. `lead()` only returns an episode when the sources agree or one source is alone.
- A blocked or stale source flags its own chip (top strip: status, stale, fetch time, rate-limit countdown) and its own cells; the rest of the screen stays.
- Every mention of Trakt, Simkl, MAL or AniList goes through `SourceName` / `SourceIcon` / `sourceSpan` (logo in brand colour).
- Progress: only legacy's "Aired vs upcoming" style (`ProgressSegments`), no picker: watched solid, the next episode amber when out or dashed while still to air, the rest dimmed; caption "N watched · next is out · L left". Legacy had seven styles.
- Posters: relative URLs (the demo's `/_demo/poster`) load from the server with the Access headers; absolute URLs on other hosts never get them (`PosterSource`).

## Writes

`lib/writes/` (#108, step 3.5; ported from legacy `MarkWatchedModal.vue`, `StartSeasonModal.vue`, `ComingBack.vue`, `pages/log.vue`, `log-groups.ts`).

- Every write to Trakt, Simkl or MAL: `MarkFlow` / `StartFlow` call the preview, the sheet shows each source's step with a checkbox, and only the confirm button calls the confirm, with the previewed steps (and their `expected`) for the ticked sources. `confirm()` does nothing without a preview. A failed source shows its own error and a Retry for just that source; nothing is queued or retried by itself.
- Mark confirm: a step with `after` always sends `status`, null included (null = leave it to the source; a missing `status` would keep the preview's suggestion). The generated `toJson` drops nulls, hence `_ConfirmStep`.
- Accept/undo and Coming back dismiss/undo change only Tsuzuku's own data (no source write, no preview, as legacy). Accept updates the row in place instead of reloading.
- Error text: the server's `statusMessage` (h3 errors) via `writeErrorText`, else `describeError`.
- Write log: `WriteLogScreen` (app bar, history icon), grouped by `groupLog` (days in local time; one mark per `markId`).

## Navigation and Movies

- `HomeScreen` (#108, 3.6): legacy's tab bar, Shows, Movies, Calendar, Stats, Log, Settings, in a bottom `NavigationBar`: full width under 640 px, from 640 px a floating bar of its own width (at most 512 px), centred, 16 px off the bottom edge, as legacy. Each tab is its own `Scaffold` with its own app bar (`tabAppBar` in `screens/app_title.dart`: title on the left on every platform, title and actions lined up with the 1280 px content column), built on first open and then kept (`IndexedStack`). Mappings is reached from Settings, as in legacy.
- Movies: `lib/movies/` (legacy `pages/movies.vue`, `MovieAddModal.vue`, `MovieMarkModal.vue`). One card per movie, each source's own state on the opened card, never merged. `MovieMarkFlow` / `MovieAddFlow` follow the write rules above (preview, ticked sources, confirm; optional mark steps start unticked; a Trakt movie or MAL entry is only ever picked among real search results and previews again before any write). Shows add: `writes/anime_add.dart` (legacy `AnimeAddModal.vue`): AniList search (anime movies left out, they go on Movies), Watching or Plan to Watch, preview for Simkl and MAL, confirm; Trakt is never offered (link it on Mappings). Shared sheet parts (`SheetFrame`, `SheetAlert`, `OutcomeMark`, `ScoreMenu`, `errorLine`) are in `writes/write_sheets.dart`.

## Calendar

`lib/calendar/` (legacy `pages/calendar.vue`): last, this and next month (local month start to next month start, sent as UTC). An agenda from today under 1000 px of content width, a Monday-first month grid from 1000 px. Each source's item stays its own line (both dates show when they disagree); one show's items sit together, shaded. A date-only item (Simkl) keeps its written date. Read-only: items open their source's page.

## Mappings

`lib/mappings/` (legacy `pages/mappings.vue`, `LinksTable.vue`, `LinkToTraktModal.vue`, `entry-view.ts`), opened from Settings and from the Shows "links wait for your confirm" notice. Needs your confirm (Trakt season, offset, what that means per source), Not linked to Trakt (Link to Trakt: only shows Trakt's search returns), Linked (Anime / Shows / Unlinked shows; a list with a menu and an edit sheet under 900 px of content width, legacy's table with in-row edit from 900 px). These change only Tsuzuku's own links, never the sources, so there is no per-source preview: every change waits for its explicit button (Confirm, Not this show, Save, Link again) and Unlink asks twice. `MappingsController` reloads after each change.

## Stats

`lib/stats/` (legacy `pages/stats.vue`, `StatusBar.vue`, `RatingsChart.vue`, `MarksChart.vue`): one card per source with its own figures (never added up), list-status bars, history (this week from Monday, this month, 4-week average, local time), ratings, and the Marked from Tsuzuku cards with 30 local days of marks. Stacked under 1000 px of content width, three across from 1000 px. Refresh sends `refresh=1`. Charts are plain widgets (no chart package). Colours come from `StatusColors` (`lib/theme/status_colors.dart`, a theme extension; legacy's default palette).

## Settings

`screens/settings_screen.dart` with `lib/settings/` (legacy `SettingsPanel.vue`): Appearance (System / Light / Dark in `shared_preferences`, `AppearanceController`), Sources (sources that need you open; the rest folded into one "sources OK" row; status chips; Connect / Reconnect opens the system browser at `<server>/api/auth/<source>/start`, the server keeps the token, the app reads the status again on resume; the demo refuses with 400), Mappings, Backups (Back up now; newest shown, older ones folded; Download fetches through the API and saves with `file_picker`'s save dialog, a browser download on web), Server, About. No progress-style picker: Aired vs upcoming is the only style (decided in 3.4).

## Local snapshot and offline

`lib/snapshot/` (#108, step 3.7). Native only: `AppController.snapshots` is `SnapshotCache.off()` on web and on a `TSUZUKU_DEV_SERVER` run.

- Up Next, Movies, Calendar (this month only; its range is the snapshot's scope) and Stats save their last successful answer as JSON (`<app support>/snapshot/<key>.json`, replaced whole via a temp file and rename) after a live read succeeds, never after a failure. On open the saved answer shows at once under the loading bar (no note), then the live answer replaces it. If the live read fails, `SnapshotNotice` says "Saved copy from …, not live" with its fetch time. The saved answer is shown as it was: its stale and blocked flags stay, rate-limit countdowns count from its fetch time.
- `meta.json` holds the app's `apiVersion`, the server's `apiVersion` and the server URL. The snapshot is dropped when any of them changes and when Settings → Server saves another URL or token (`AppController.save`). It never holds the Access token; that stays in secure storage.
- Offline: `ReachabilityInterceptor` sets `AppController.offline` when a request cannot reach the server (connection error or connect/send timeout) and clears it on any answer. While offline, or while a screen shows its saved answer, its write buttons are disabled (Up Next actions, Add an anime, Movies add / mark / fill / unlink) and the notice says so. Nothing is queued or retried; a pull to refresh tries again.
- A display cache only: no background sync, no job queue.

## Theme

One theme, Solid Glass (decision #26; legacy `solid-glass` in `main.css`, ported as it is), light and dark: `lib/theme/solid_glass.dart`. `solidGlassTheme(brightness)` is the `ThemeData`; `Glass` (a theme extension, `Glass.of(context)`) holds what Material lacks: text tones, success / warning / info, the card and floating panes (rim, hairline, inner line, outer shadow, blur), the one-state pane, the ink button, the page lights. Values are legacy's oklch tokens converted to sRGB; don't rework them, a new idea is a new theme. Screens take colours from the theme only: `colorScheme` or `Glass`, never `Colors.*` (source logos keep their brand colours, list-status colours are `StatusColors`).

- Cards are `PaneCard` (edge colour only where it says something: differs, failed). Sheets, dialogs and the tab bar are `FloatPane` (blur). `OuterShadows` draws shadows only outside a pane, since the faces are see-through. `GlassPage` (MaterialApp `builder`) paints the page and its lights; scaffolds are transparent. Lists add `MediaQuery.paddingOf(context).bottom` so the last item clears the floating tab bar.
- Primary buttons: `FilledButton` (themed) or `inkPaneIconStyle(context)` for round icon buttons.
- Font: Geist (`assets/fonts/geist/`, OFL), Regular to Bold.
- Goldens: `test/golden_test.dart` (Up Next and the Mark sheet, light and dark; 2 % pixel tolerance for Flutter version drift). After a deliberate change: `flutter test --update-goldens test/golden_test.dart`, look at `test/goldens/`, commit.

## Layout

```
lib/
  main.dart             app, routing between first run, token refused and home
  app_controller.dart   server config, API client, version check, Access state
  server/               ServerConfig and its secure store, Dio setup, Access detection
  screens/              first run / server form, token refused, home, settings, update widgets
  update/               in-app updates and What's new
  up_next/              Up Next (3.4): row logic (up_next_logic.dart, pure, tested on the fixtures), card, screen,
                        source logos (simple_icons), posters (cached_network_image)
  writes/               writes (3.5): preview/confirm flows and sheets, Coming back, write log
  movies/               Movies (3.6): row logic, add / mark flows and sheets, screen
  calendar/             Calendar (3.6): day/grid logic (pure), screen
  mappings/             Mappings (3.6): row logic (pure), controller, widgets and sheets, screen
  stats/                Stats (3.6): figures, history and marks logic (pure), screen with bars and charts
  settings/             Settings (3.6): sources, backups, appearance
  snapshot/             local snapshot (3.7): saved answers of the screens shown on open, the "saved copy" / offline notice
  theme/                Solid Glass theme and panes (solid_glass.dart), StatusColors
  api/                  generated, do not edit
tool/generate_api.dart  regenerates lib/api/
tool/whats_new.dart     writes assets/whats_new.json (CI)
test/                   unit, widget and fixture tests; test/support/ has fake HTTP adapters
```
