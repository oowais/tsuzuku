// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui'
  ],

  devtools: {
    enabled: true
  },

  css: ['~/assets/css/main.css'],

  ui: {
    theme: {
      colors: ['primary', 'neutral', 'success', 'warning', 'error']
    }
  },

  compatibilityDate: '2026-06-30',

  // Workaround for nuxt/nuxt#36467: on Windows, Nuxt 4.6.0 SSR pages return 500
  // "Either manifest or precomputed data must be provided". Remove after upgrading past 4.6.0.
  nitro: {
    externals: {
      inline: [/[\\/]node_modules[\\/]nuxt[\\/]dist[\\/]/]
    },
    // The nightly backup (decision #18), at 03:00 in the server's time zone (TZ, UTC in the container by default).
    experimental: { tasks: true },
    scheduledTasks: { '0 3 * * *': ['backup:nightly'] }
  },

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  }
})
