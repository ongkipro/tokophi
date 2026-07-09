# TokoΦ storefront (Astro SSG). BUILD CONTEXT = repo root (npm workspaces monorepo).
# The catalog is read from Postgres at BUILD time (astro.config surfaces DATABASE_URL onto
# process.env), so the static build runs at CONTAINER START — after Postgres is up + seeded —
# then the generated `dist/` is served statically. Keeps the storefront SSG (no SSR refactor).
FROM node:24-alpine AS build
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY . .
RUN npm ci && npm i -g serve
ENV NODE_ENV=production
EXPOSE 4327
CMD ["sh", "-c", "npm run build -w @tokophi/storefront && serve -l 4327 apps/storefront/dist"]
