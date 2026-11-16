# syntax=docker/dockerfile:1
# Tsuzuku: one container, the SQLite file on a volume at /data (docs/plan.md, Auth and deployment).
# Build from the repository root, so the commit can be read from .git: `docker build -f legacy/Dockerfile .`
# (the ignore file is Dockerfile.dockerignore next to this file).
# Vite+ installs and builds; Node runs the app (better-sqlite3 is a native Node addon; its prebuilt binaries
# are N-API, so they load on the runtime's Node version too).
ARG NODE_VERSION=26
ARG VITE_PLUS_VERSION=1.0.0
# The Flutter version CI builds the app with (.github/workflows/app.yml, app-release.yml); keep them in step.
ARG FLUTTER_VERSION=3.47.9

# The Flutter web build (#108, step 4.1), served by the server at `/`. No server URL or token goes in: it calls
# its own origin. What's new stays empty here (tool/whats_new.dart needs the full history; the web build has no
# in-app update anyway).
FROM debian:trixie-slim AS web
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git unzip xz-utils \
  && rm -rf /var/lib/apt/lists/*
ARG FLUTTER_VERSION
RUN git clone --depth 1 --branch "${FLUTTER_VERSION}" https://github.com/flutter/flutter.git /opt/flutter
ENV PATH=/opt/flutter/bin:$PATH
RUN flutter --disable-analytics && flutter precache --web
WORKDIR /src/app
COPY app/pubspec.yaml app/pubspec.lock ./
RUN flutter pub get --enforce-lockfile
COPY app/ ./
RUN flutter build web --release

FROM ghcr.io/voidzero-dev/vite-plus:${VITE_PLUS_VERSION} AS build
WORKDIR /app
# Build on the runtime's Node major (engines.node alone picks 24); vp reads .node-version before engines.
ARG NODE_VERSION
RUN echo "${NODE_VERSION}" > .node-version
COPY --chown=vp:vp legacy/package.json legacy/pnpm-lock.yaml legacy/pnpm-workspace.yaml ./
# The postinstall `nuxt prepare` needs the sources and `prepare` installs git hooks; `nuxt build` prepares anyway.
RUN vp install --frozen-lockfile --ignore-scripts
COPY --chown=vp:vp legacy/ ./
COPY --chown=vp:vp .git ./.git
COPY --from=web --chown=vp:vp /src/app/build/web ./flutter-web
# `nuxt build` alone: the `build` script's `nuxt prepare` only restores dev types, nothing the image needs.
# FLUTTER_WEB_DIR bundles the web build into .output/public (nuxt.config.ts).
RUN FLUTTER_WEB_DIR=/app/flutter-web vp exec nuxt build
# The commit for the startup log line (#92), read from the .git files Dockerfile.dockerignore lets in; no git binary.
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
COPY legacy/scripts ./scripts
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", ".output/server/index.mjs"]
