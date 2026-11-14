# Affiliate TokoΦ (apps/affiliate, ADR 0022) — Astro SSR on @astrojs/node standalone. BUILD CONTEXT = repo root.
# One origin for every store's affiliates (affiliate.tokophi.com); NOT tenant-resolved. The image builds
# WITHOUT a database or any secret — everything is read from process.env at request time.
# Runtime env: DATABASE_URL (required); AFFILIATE_APP_URL = this app's own public origin, THE switch
# (unset = every page answers "belum dibuka", 503); STOREFRONT_BASE_DOMAIN (share-link base).
# Port 4330 (= its `astro dev` port, like account 4329). Healthcheck: GET /healthz on 127.0.0.1 —
# busybox wget tries ::1 first and the node adapter binds IPv4 only (DEPLOY.md).

# ── build: the whole monorepo, dev deps included (astro + vite bundle @tokophi/db and @tokophi/lib
#    into dist/server, so the runtime never needs the workspace sources).
FROM node:24-alpine AS build
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY . .
RUN npm ci
RUN npm run build -w @tokophi/affiliate

# ── deps: production dependencies of THIS workspace only (astro runtime, drizzle-orm, postgres, cookie).
FROM node:24-alpine AS deps
WORKDIR /app
COPY . .
RUN npm ci --omit=dev --workspace @tokophi/affiliate --ignore-scripts

# ── runtime: non-root, built output + pruned node_modules, no source and no build tooling.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4330
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/affiliate/package.json ./apps/affiliate/package.json
COPY --from=build /app/apps/affiliate/dist ./apps/affiliate/dist
USER node
EXPOSE 4330
CMD ["node", "apps/affiliate/dist/server/entry.mjs"]
