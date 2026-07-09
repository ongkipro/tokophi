# TokoΦ super-admin (Next.js). BUILD CONTEXT = repo root (npm workspaces monorepo).
#   docker build -f apps/super-admin/Dockerfile -t tokophi-super .
FROM node:24-alpine AS build
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npm ci
# dummy DATABASE_URL just for build (postgres.js is lazy; runtime uses the real URL from compose)
RUN DATABASE_URL=postgres://build:build@localhost:5432/build npm run build -w @tokophi/super-admin

ENV NODE_ENV=production PORT=3001
EXPOSE 3001
CMD ["npm", "run", "start", "-w", "@tokophi/super-admin"]
