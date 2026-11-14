# Tsuzuku app (Flutter)

The Flutter app for Android, Windows, Linux and web (#108, phase 3). It talks only to the Tsuzuku server, through the contract in `../api/openapi.yaml`; until cutover that is the legacy Nuxt server. Shared rules, layout and docs are in the root `CLAUDE.md` and `../docs/`. Run every command below from this folder.

App id `com.owaisahmed.tsuzuku` (Android `applicationId`, Linux `APPLICATION_ID`). It never changes: a new id is a new app that does not update the old one.

## Tool chain

`flutter` (stable) and `dart` only. No npm, vp or other JS tooling in this folder.

- Packages: `flutter pub add <pkg>` / `flutter pub add --dev <pkg>` / `flutter pub remove <pkg>`. Commit `pubspec.lock`.
- Before committing: `dart format lib test tool`, `flutter analyze`, `flutter test`. All three must be clean.
- Run: `flutter run -d linux`; web with `flutter run -d web-server --web-port 8080`, then open `http://localhost:8080` in Firefox (no Chrome here). On Android: `flutter run -d <device>` once the Android SDK is set up (`flutter doctor`).
- Builds: `flutter build linux`, `flutter build web`, `flutter build apk`, `flutter build windows` (on Windows). Local release APKs are signed with the debug key; only CI signs with the release key.
- Icons: sources in `assets/icon/` (from the legacy web app; `adaptive-foreground.png` is `favicon.svg` on a transparent 1024 canvas). After changing them: `dart run flutter_launcher_icons`.

## API client

`lib/api/` is generated from the contract by [swagger_parser](https://pub.dev/packages/swagger_parser) (plain Dio client, plain DTOs, no build_runner). Never edit it by hand.

- Regenerate after any change to `../api/openapi.yaml`: `dart run tool/generate_api.dart`. CI runs it with `--check` and fails when `lib/api/` is out of date.
- `tool/generate_api.dart` feeds the generator a normalized copy of the contract (zod's `anyOf` with null becomes a nullable type, `additionalProperties: false` is dropped so additive server changes don't break older apps, untyped literals get a type). The contract itself stays as the legacy check needs it.
- `TsuzukuApi.apiVersion` is the contract's `info.version`, built into the app. A different `apiVersion` from `/api/health` shows the update banner.
- `test/fixtures_test.dart` replays the golden fixtures (`../api/fixtures/`) through the generated client: every recorded read must decode.

## Server and Cloudflare Access

- Native: the first run asks for the server URL and the Access service token (`CF-Access-Client-Id`, `CF-Access-Client-Secret`), calls `/api/sources/status` with them, and only then stores them in `flutter_secure_storage`. Settings → Server changes them. Empty token fields are allowed for a server without Access (the local demo).
- Web: served by the server itself; same origin, relative URLs, the browser's Access cookie, no first-run screen.
- A 403, or a redirect to `*.cloudflareaccess.com` instead of JSON, shows the "token refused" screen (`lib/screens/access_rejected_screen.dart`). Native Dio does not follow redirects, so the redirect stays visible.
- Never log, print or show the client secret. Error messages never include request headers.

## Releases

`.github/workflows/app-release.yml` runs on a tag `app-vX.Y.Z` (tags only, never branches or PRs) and publishes a GitHub Release. The tag must equal `version:` in `pubspec.yaml`, so bump that first. The build number there is ignored: the Android versionCode is X*1000000 + Y*1000 + Z. Pushing a tag publishes a public Release: ask first.

- Release files (fixed names; the in-app updater, step 3.3, looks for them): `tsuzuku.apk`, `tsuzuku-setup.exe` + `.sig`, `tsuzuku-x86_64.AppImage` + `.sig`. The web build is a workflow artifact `tsuzuku-web-X.Y.Z` for the backend image, not a Release file.
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

## Layout

```
lib/
  main.dart             app, routing between first run, token refused and home
  app_controller.dart   server config, API client, version check, Access state
  server/               ServerConfig and its secure store, Dio setup, Access detection
  screens/              first run / server form, token refused, home, settings, update widgets
  update/               in-app updates and What's new
  api/                  generated, do not edit
tool/generate_api.dart  regenerates lib/api/
tool/whats_new.dart     writes assets/whats_new.json (CI)
test/                   unit, widget and fixture tests; test/support/ has fake HTTP adapters
```
