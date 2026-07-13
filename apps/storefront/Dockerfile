# TokoΦ storefront (Astro SSR, @astrojs/node standalone). BUILD CONTEXT = repo root (monorepo).
# MULTI-TENANT: one image serves every store — the tenant is resolved from the request's `Host`
# header at REQUEST time (src/middleware.ts → src/data/store.ts), so the image builds WITHOUT a
# database (no DATABASE_URL) and the container starts in seconds.
# Runtime env: DATABASE_URL (required), STORE_SLUG / DEFAULT_STORE_SLUG (fallback store when the
# host names none), STOREFRONT_BASE_DOMAIN (optional, for <slug>.toko.tokophi.com routing).
FROM node:24-alpine AS build
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY . .
RUN npm ci
# SSR build needs no DB (page code + catalog queries run at runtime, not build) — bundling only.
RUN npm run build -w @tokophi/storefront
ENV NODE_ENV=production
# @astrojs/node standalone reads HOST/PORT from the env.
ENV HOST=0.0.0.0
ENV PORT=4327
EXPOSE 4327
CMD ["node", "apps/storefront/dist/server/entry.mjs"]
