# syntax=docker/dockerfile:1

# Multi-stage build: compile with the full toolchain, ship only what runs.
#
# `npm ci` installs exactly what package-lock.json locks, so the lockfile must be
# committed and in step with package.json: run `npm install` after you change a
# dependency, and commit the new lockfile.
#
# Node 22 is the LTS line NestJS 11 is built and tested on (D21 in docs/DECISIONS.md).
#
# Cloud: the image has no settings baked in. It listens on $PORT (3000 by default,
# which is also what Cloud Run, Render and similar platforms inject), takes the
# database from $MONGODB_URI (an Atlas mongodb+srv:// string works as is) and
# answers GET /health for the platform's liveness check and GET /ready for
# readiness. Everything it reads is in .env.example.

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
# The official image ships a non-root "node" user. Never run the API as root.
USER node
EXPOSE 3000
# Liveness only (GET /health never touches MongoDB). The slim image has no curl,
# so the check uses Node's built-in fetch.
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/main"]
