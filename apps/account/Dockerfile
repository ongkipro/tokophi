# Akun TokoΦ (apps/account, ADR 0016) — Astro SSR on @astrojs/node standalone. BUILD CONTEXT = repo root.
# One origin for every shop's buyers (account.tokophi.com); NOT tenant-resolved. The image builds
# WITHOUT a database or any secret — everything is read from process.env at request time.
# Runtime env: DATABASE_URL, AUTH_SECRET (required); GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET /
# ACCOUNT_GOOGLE_REDIRECT_URI (unset = the account answers "belum dibuka" on every page, 503);
# ACCOUNT_CLAIM_SECRET (unset = /klaim answers "belum tersedia"); ADMIN_URL, STOREFRONT_BASE_DOMAIN.
# Port 4329 (= its `astro dev` port, like storefront 4327 / landing 4328). Healthcheck: GET /healthz on
# 127.0.0.1 — busybox wget tries ::1 first and the node adapter binds IPv4 only (DEPLOY.md).

# ── build: the whole monorepo, dev deps included (astro + vite bundle @tokophi/db and @tokophi/lib
#    into dist/server, so the runtime never needs the workspace sources).
FROM node:24-alpine AS build
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY . .
RUN npm ci
RUN npm run build -w @tokophi/account

# ── deps: production dependencies of THIS workspace only (astro runtime, drizzle-orm, postgres,
#    jose, cookie) — not the 1 GB tree admin/super-admin need.
FROM node:24-alpine AS deps
WORKDIR /app
COPY . .
RUN npm ci --omit=dev --workspace @tokophi/account --ignore-scripts

# ── runtime: non-root, built output + pruned node_modules, no source and no build tooling.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4329
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/account/package.json ./apps/account/package.json
COPY --from=build /app/apps/account/dist ./apps/account/dist
USER node
EXPOSE 4329
CMD ["node", "apps/account/dist/server/entry.mjs"]
