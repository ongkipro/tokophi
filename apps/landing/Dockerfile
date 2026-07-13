# TokoΦ landing (Astro STATIC, served by @astrojs/node standalone). BUILD CONTEXT = repo root (monorepo).
# The front door for tokophi.com (apex + www). NO database: the build and the runtime never touch
# Postgres (no DATABASE_URL, no @tokophi/db dep) — this page must be servable even if everything
# else is down. Every route is prerendered at build time; the node process only serves dist/client.
# Build-time env (baked into the HTML, PUBLIC_* only):
#   PUBLIC_LOGIN_URL  (default https://app.tokophi.com/login)
#   PUBLIC_SIGNUP_URL (default https://app.tokophi.com/daftar)
# Runtime env: HOST (0.0.0.0), PORT (4328).
FROM node:24-alpine AS build
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY . .
RUN npm ci
ARG PUBLIC_LOGIN_URL
ARG PUBLIC_SIGNUP_URL
ENV PUBLIC_LOGIN_URL=${PUBLIC_LOGIN_URL}
ENV PUBLIC_SIGNUP_URL=${PUBLIC_SIGNUP_URL}
RUN npm run build -w @tokophi/landing
ENV NODE_ENV=production
# @astrojs/node standalone reads HOST/PORT from the env and binds IPv4 only —
# the container healthcheck MUST use http://127.0.0.1:4328/ (busybox `wget localhost`
# resolves ::1 first and would report a false 'unhealthy'). See specs/docs/DEPLOY.md.
ENV HOST=0.0.0.0
ENV PORT=4328
EXPOSE 4328
CMD ["node", "apps/landing/dist/server/entry.mjs"]
