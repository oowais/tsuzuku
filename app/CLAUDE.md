# Tsuzuku app (Flutter)

The Flutter app for Android, Windows, Linux and web (#108, phase 3). It talks only to the Tsuzuku server, through the contract in `../api/openapi.yaml`; until cutover that is the legacy Nuxt server. Shared rules, layout and docs are in the root `CLAUDE.md` and `../docs/`. Run every command below from this folder.

App id `com.owaisahmed.tsuzuku` (Android `applicationId`, Linux `APPLICATION_ID`). It never changes: a new id is a new app that does not update the old one.

## Tool chain

`flutter` (stable) and `dart` only. No npm, vp or other JS tooling in this folder.

- Packages: `flutter pub add <pkg>` / `flutter pub add --dev <pkg>` / `flutter pub remove <pkg>`. Commit `pubspec.lock`.
- Before committing: `dart format lib test tool`, `flutter analyze`, `flutter test`. All three must be clean.
- Run: `flutter run -d linux`; web with `flutter run -d web-server --web-port 8080`, then open `http://localhost:8080` in Firefox (no Chrome here). On Android: `flutter run -d <device>` once the Android SDK is set up (`flutter doctor`).
- Builds: `flutter build linux`, `flutter build web`, `flutter build apk`, `flutter build windows` (on Windows). Release builds, signing and CI for them are step 3.2.
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

## Layout

```
lib/
  main.dart             app, routing between first run, token refused and home
  app_controller.dart   server config, API client, version check, Access state
  server/               ServerConfig and its secure store, Dio setup, Access detection
  screens/              first run / server form, token refused, home, settings
  api/                  generated, do not edit
tool/generate_api.dart  regenerates lib/api/
test/                   unit, widget and fixture tests; test/support/ has fake HTTP adapters
```
