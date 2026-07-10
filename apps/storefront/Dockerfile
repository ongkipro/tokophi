# TokoΦ storefront (Astro SSR, @astrojs/node standalone). BUILD CONTEXT = repo root (monorepo).
# The catalog is read from Postgres at SERVER BOOT (module-level in src/data/catalog.ts), NOT during
# `astro build` — so the image builds WITHOUT a database, and the container starts in seconds instead
# of running a full static build first. This removes the deploy downtime the old SSG build-at-start had.
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
