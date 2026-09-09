# TokoΦ landing (Astro STATIC, served by @astrojs/node standalone). BUILD CONTEXT = repo root (monorepo).
# The front door for tokophi.com (apex + www). NO database: the build and the runtime never touch
# Postgres (no DATABASE_URL, no @tokophi/db dep) — this page must be servable even if everything
# else is down. Every route is prerendered at build time; the node process only serves dist/client.
# Build-time env (baked into the HTML, PUBLIC_* only):
#   PUBLIC_LOGIN_URL  (default https://app.tokophi.com/login)
#   PUBLIC_SIGNUP_URL (default https://app.tokophi.com/daftar)
#   PUBLIC_DEMO_URL   (default https://batiknusantara.tokophi.id) — the "Buka demo" store
#   PUBLIC_LEGAL_NAME / PUBLIC_LEGAL_ADDRESS / PUBLIC_CONTACT_EMAIL / PUBLIC_CONTACT_WHATSAPP
#     — the operating entity and how to reach it. NO DEFAULTS ON PURPOSE: nothing in this repo
#     establishes them, and /privasi + /kontak print an explicit "belum dicantumkan" notice while
#     they are empty rather than rendering an invented placeholder as if it were a real fact.
#     See apps/landing/src/lib/identity.ts.
# Runtime env: HOST (0.0.0.0), PORT (4328).
FROM node:24-alpine AS build
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY . .
RUN npm ci
# Defaults MUST live here: a bare `ARG X` with no build-arg passed sets X to the empty string,
# which is not `undefined` — the page's fallback would not fire and the CTAs would render href="".
ARG PUBLIC_LOGIN_URL=https://app.tokophi.com/login
ARG PUBLIC_SIGNUP_URL=https://app.tokophi.com/daftar
ARG PUBLIC_DEMO_URL=https://batiknusantara.tokophi.id
ENV PUBLIC_LOGIN_URL=${PUBLIC_LOGIN_URL}
ENV PUBLIC_SIGNUP_URL=${PUBLIC_SIGNUP_URL}
ENV PUBLIC_DEMO_URL=${PUBLIC_DEMO_URL}
# Identity: empty by design (see the header). An empty value here is exactly what the page treats
# as "not supplied" — that is the whole contract, so do NOT invent defaults for these four.
ARG PUBLIC_LEGAL_NAME=
ARG PUBLIC_LEGAL_ADDRESS=
ARG PUBLIC_CONTACT_EMAIL=
ARG PUBLIC_CONTACT_WHATSAPP=
ENV PUBLIC_LEGAL_NAME=${PUBLIC_LEGAL_NAME}
ENV PUBLIC_LEGAL_ADDRESS=${PUBLIC_LEGAL_ADDRESS}
ENV PUBLIC_CONTACT_EMAIL=${PUBLIC_CONTACT_EMAIL}
ENV PUBLIC_CONTACT_WHATSAPP=${PUBLIC_CONTACT_WHATSAPP}
RUN npm run build -w @tokophi/landing
ENV NODE_ENV=production
# @astrojs/node standalone reads HOST/PORT from the env and binds IPv4 only —
# the container healthcheck MUST use http://127.0.0.1:4328/ (busybox `wget localhost`
# resolves ::1 first and would report a false 'unhealthy'). See specs/docs/DEPLOY.md.
ENV HOST=0.0.0.0
ENV PORT=4328
EXPOSE 4328
CMD ["node", "apps/landing/dist/server/entry.mjs"]
