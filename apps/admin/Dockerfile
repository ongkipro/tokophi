# TokoΦ admin (Next.js). BUILD CONTEXT = repo root (npm workspaces monorepo),
# so the @tokophi/* workspace packages resolve. Build with:
#   docker build -f apps/admin/Dockerfile -t tokophi-admin .
FROM node:24-alpine AS build
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# copy the whole monorepo (node_modules/.next/.env excluded via .dockerignore)
COPY . .
RUN npm ci
# dummy DATABASE_URL just for build (Next collects API-route data → imports @tokophi/db which
# `@tokophi/db` now defaults production imports to the restricted app-role path. Build uses the owner
# path explicitly with a dummy URL so route collection can import the module without a real database.
RUN DATABASE_RUNTIME_ROLE=owner DATABASE_URL=postgres://build:build@localhost:5432/build npm run build -w @tokophi/admin

ENV NODE_ENV=production PORT=3000
EXPOSE 3000
# next start binds 0.0.0.0 and honors PORT
CMD ["npm", "run", "start", "-w", "@tokophi/admin"]
