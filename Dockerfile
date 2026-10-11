# syntax=docker/dockerfile:1
# Tsuzuku: one container, the SQLite file on a volume at /data (docs/plan.md, Auth and deployment).
# Vite+ installs and builds; Node runs the app (better-sqlite3 is a native Node addon; its prebuilt binaries
# are N-API, so they load on the runtime's Node version too).
ARG NODE_VERSION=26
ARG VITE_PLUS_VERSION=1.0.0

FROM ghcr.io/voidzero-dev/vite-plus:${VITE_PLUS_VERSION} AS build
WORKDIR /app
COPY --chown=vp:vp package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# The postinstall `nuxt prepare` needs the sources and `prepare` installs git hooks; `nuxt build` prepares anyway.
RUN vp install --frozen-lockfile --ignore-scripts
COPY --chown=vp:vp . .
RUN vp run build
# The commit for the startup log line (#92), read from the .git files .dockerignore lets in; no git binary.
RUN vp env exec node server/lib/version.ts > COMMIT

FROM node:${NODE_VERSION}-slim
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/data/tsuzuku.db \
    MIGRATIONS_DIR=/app/server/db/migrations \
    COMMIT_FILE=/app/COMMIT
# The built server carries its own node_modules, better-sqlite3's prebuilt binaries included.
COPY --from=build /app/.output ./.output
# Applied at startup (server/db/index.ts).
COPY --from=build /app/server/db/migrations ./server/db/migrations
COPY --from=build /app/COMMIT ./COMMIT
COPY scripts ./scripts
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", ".output/server/index.mjs"]
