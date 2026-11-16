// https://nuxt.com/docs/api/configuration/nuxt-config
import { readdirSync } from "node:fs";

// The Flutter web build (#108, step 4.1), served at `/` as static files: the only UI (the Vue UI went in step 4.3).
// Set by the image build (Dockerfile); unset in dev and in the contract check, where only the API is served.
const flutterWeb = process.env.FLUTTER_WEB_DIR;

// Flutter's file names carry no hash (main.dart.js, flutter_bootstrap.js, assets/), so every one of them is
// revalidated on each load (ETag): without a Cache-Control header, Cloudflare and browsers would keep an old build
// after a deploy.
const flutterNoCache = Object.fromEntries(
  flutterWeb
    ? [
        "/",
        ...readdirSync(flutterWeb, { withFileTypes: true }).map((e) =>
          e.isDirectory() ? `/${e.name}/**` : `/${e.name}`,
        ),
      ].map((path) => [path, { headers: { "cache-control": "no-cache" } }])
    : [],
);

export default defineNuxtConfig({
  compatibilityDate: "2026-06-30",

  routeRules: flutterNoCache,

  // Workaround for nuxt/nuxt#36467: on Windows, Nuxt 4.6.0 SSR pages return 500
  // "Either manifest or precomputed data must be provided". Remove after upgrading past 4.6.0.
  nitro: {
    externals: {
      inline: [/[\\/]node_modules[\\/]nuxt[\\/]dist[\\/]/],
    },
    // The nightly backup (decision #18), at 03:00 in the server's time zone (TZ, UTC in the container by default).
    experimental: { tasks: true },
    scheduledTasks: { "0 3 * * *": ["backup:nightly"] },
    // Not hashed (main.dart.js, flutter_bootstrap.js), so no long cache: the ETag revalidates them after a deploy.
    publicAssets: flutterWeb ? [{ dir: flutterWeb, baseURL: "/", maxAge: 0 }] : [],
  },
});
