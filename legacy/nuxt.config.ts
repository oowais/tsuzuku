// https://nuxt.com/docs/api/configuration/nuxt-config

// The Flutter web build (#108, step 4.1), served at `/` as static files; the Vue pages live under `/legacy/`
// (app/pages/legacy/) until they are removed (step 4.3). Set by the image build (Dockerfile); unset in dev and in the
// contract check, where only the Vue UI is served.
const flutterWeb = process.env.FLUTTER_WEB_DIR;

export default defineNuxtConfig({
  modules: ["@nuxt/ui"],

  devtools: {
    enabled: true,
  },

  css: ["~/assets/css/main.css"],

  ui: {
    theme: {
      colors: ["primary", "neutral", "success", "warning", "error"],
    },
  },

  compatibilityDate: "2026-06-30",

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
