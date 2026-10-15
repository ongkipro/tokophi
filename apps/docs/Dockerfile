# Panduan TokoΦ (apps/docs, Task 8.37) — the Seller help center. BUILD CONTEXT = repo root (monorepo).
# Fully static: no database, no env, no session; it must stay readable when everything else is down.
# Astro 7 + Starlight build to dist/ (pages + Pagefind index); nginx serves the files.
# Runtime: port 4339. Healthcheck must use 127.0.0.1 (busybox wget tries ::1 first; see DEPLOY.md).
FROM node:24-alpine AS build
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY . .
RUN npm ci
RUN npm run check -w @tokophi/docs

FROM nginx:1.27-alpine
COPY apps/docs/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/docs/dist /usr/share/nginx/html
EXPOSE 4339
