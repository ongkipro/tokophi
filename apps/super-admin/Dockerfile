# TokoΦ super-admin (Next.js). BUILD CONTEXT = repo root (npm workspaces monorepo).
#   docker build -f apps/super-admin/Dockerfile -t tokophi-super .
FROM node:24-alpine AS build
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npm ci
# `@tokophi/db` now defaults production imports to the restricted app-role path. Build uses the owner
# path explicitly with a dummy URL so route collection can import the module without a real database.
RUN DATABASE_RUNTIME_ROLE=owner DATABASE_URL=postgres://build:build@localhost:5432/build npm run build -w @tokophi/super-admin

ENV NODE_ENV=production PORT=3001
EXPOSE 3001
CMD ["npm", "run", "start", "-w", "@tokophi/super-admin"]
