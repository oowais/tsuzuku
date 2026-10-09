# syntax=docker/dockerfile:1
# Tsuzuku: one container, the SQLite file on a volume at /data (docs/plan.md, Auth and deployment).
# bun installs and builds; Node runs the app (better-sqlite3 is a native Node addon, never run under bun).
ARG NODE_VERSION=26

FROM node:${NODE_VERSION}-slim AS build
WORKDIR /app
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun
COPY package.json bun.lock ./
# The postinstall `nuxt prepare` needs the sources; `nuxt build` prepares anyway.
RUN bun install --frozen-lockfile --ignore-scripts
COPY . .
RUN bun run build

FROM node:${NODE_VERSION}-slim
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/data/tsuzuku.db \
    MIGRATIONS_DIR=/app/server/db/migrations
# The built server carries its own node_modules, better-sqlite3's prebuilt binaries included.
COPY --from=build /app/.output ./.output
# Applied at startup (server/db/index.ts).
COPY --from=build /app/server/db/migrations ./server/db/migrations
COPY scripts ./scripts
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", ".output/server/index.mjs"]
