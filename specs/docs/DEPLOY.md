# TokoΦ — Deployment Runbook (Docker + Coolify)

> Precise deploy steps + **every gotcha/error we hit and its fix**, so migrating servers
> (Vultr → Hetzner) or re-provisioning is exact. Companion: `PROD_PLAN.md` (decisions),
> `.env.coolify.example` (env). Topology: **Cloudflare edge → Coolify/Traefik (origin) → containers**.

## Current dev server (2026-07-10) — `volumdev`

- **Vultr**, region **Singapore (sgp)**, plan `vhp-4c-8gb-amd` (4 vCPU / 8GB / 180GB NVMe), **Ubuntu 24.04.4 LTS**. ~$48/mo.
- IP **45.77.33.112**; SSH **key-only** (`ssh -i ~/.ssh/tokophi_dev root@45.77.33.112`) — password auth **disabled** (`passwordauthentication no`).
- **Coolify v4.1.2** (`http://45.77.33.112:8000`), server type = **Localhost/This Machine**. UFW active: 22/80/443/8000/6001/6002. API token at `~/.coolify_token`; app uuid `l7r4qaqcml4zigw1dc7iptun`; instance id `0d341106-34ff-4b5b-8441-9350e1b8ce35`.
- Provisioned fresh via **`vultr-cli`** + cloud-init (lean base, hardened SSH); Coolify installer auto-installs Docker. This is the **single consolidated box** — the earlier experiment box (`45.76.146.40`) was **deleted**.
- **Domains:** `admin`/`super_admin`/`storefront` on `*.45.77.33.112.sslip.io` via the app's `docker_compose_domains` DB field (Coolify's `SERVICE_FQDN` env magic doesn't wire the compose build pack — set the DB field directly; note the **super-admin** service maps to the underscore key `super_admin`).

## Deploy shape

- **Build pack = Docker Compose** (`docker-compose.coolify.yml` at repo root), NOT Nixpacks.
- Services: `postgres` + one-off `migrate` (Drizzle migrate + seed) + `admin` (:3000) + `super-admin` (:3001) + `storefront` (:4327). Ports are `expose` only → Coolify assigns a domain per service.
- Per-app Dockerfiles (`apps/*/Dockerfile`) build with **context = repo root** (workspaces resolve).
- After first deploy: assign domains per service in Coolify, then set the cross-surface env (below) + redeploy.

## ⚠️ Gotchas / errors hit → fixes (READ before re-deploying or migrating)

1. **Nixpacks / base-directory FAILS on npm workspaces.** Building `apps/admin` alone can't resolve `@tokophi/*`. → **Docker Compose build pack**, each service `build.context: .` (repo root) + `dockerfile: apps/<app>/Dockerfile`.
2. **`next build` throws `[@tokophi/db] DATABASE_URL is not set`.** Next collects data for API routes at build → imports `@tokophi/db`, which throws if the env is unset. → Pass a **dummy DATABASE_URL only on the build RUN** (`postgres://build:build@localhost:5432/build`); postgres.js is lazy so nothing connects. Runtime uses the real URL from compose. (In `apps/admin/Dockerfile` + `apps/super-admin/Dockerfile`.)
3. **Storefront (Astro) is SSR** (`@astrojs/node` standalone, `output: 'server'`) — reads Postgres at **server BOOT** (module-level in `src/data/catalog.ts`), NOT at `astro build`. So the image builds WITHOUT a DB (bundling only) and the container starts in **seconds** (`node dist/server/entry.mjs`), eliminating the deploy downtime the old SSG build-at-start caused. Dynamic routes (`produk/[handle]`, `kategori/[handle]`) resolve per-request from `Astro.params` (real + virtual collections; 404 on miss) — **no `getStaticPaths`**. `HOST=0.0.0.0`/`PORT=4327` via env. (Converted 2026-07-10; previously SSG-built-at-start.)
4. **`super-admin` has no `public/` dir** — don't `COPY` it in that Dockerfile.
5. **Migrate step**: the npm scripts wrap commands in `dotenv -e ../../.env`, which has no `.env` in Docker. → Run raw: `cd packages/db && npx drizzle-kit migrate && npx tsx src/seed.ts && npx tsx src/seed-areas.ts`, with `DATABASE_URL` in env. `drizzle.config.ts` reads `process.env.DATABASE_URL` directly. `migrate` reuses the **admin image** (has drizzle-kit + tsx + `packages/db`).
6. **`seed-areas` needs `packages/db/data/kiriminaja-areas.csv`** (400KB, **tracked in git** — Coolify clones from GitHub, so it must be committed). Made non-fatal (`|| echo skipped`) so a hiccup doesn't block the apps.
7. **RLS migration creates the `tokophi_app` role** → the migrate connection must be a **superuser**; the postgres image's `POSTGRES_USER=tokophi` is superuser of its DB, so OK. App `DATABASE_URL` connects as owner `tokophi` and switches role per-txn (RLS) — do not point apps at `tokophi_app` directly.
8. **Images are ~1.7GB** (full `node_modules` + `next start`, not standalone) — deliberate for reliability on a monorepo; disk is 350GB so fine. Optimize to standalone later only if needed.
9. **`.env*` is gitignored** → templates need an allow rule (`!.env.coolify.example` in `.gitignore`).
10. **Vultr has no Jakarta** (SG is closest, ~20-30ms) and **includes IPv4**; **Hetzner charges a small IPv4 fee** and its Asia region is Singapore-only (AMD CPX/CCX, no cloud GPU).
11. **Prod-only multi-subdomain bugs** (worked on localhost, broke on separate subdomains — will recur on Hetzner):
    - **Cross-subdomain cookies aren't shared.** Impersonation (super-admin sets the `session` cookie) failed → the admin (different subdomain) can't read it. Fix pattern: super-admin signs a short-lived token → admin `/impersonate` route verifies (same `AUTH_SECRET`) + sets the cookie on its own domain. On localhost it "worked" because cookies are host-not-port scoped.
    - **Module-scope `process.env` reads get baked at build time** (when the var is unset) for app-local server code → `ADMIN_URL` was frozen to `localhost:3000`. Read env **inside the function** at request time (workspace-package reads like the KiriminAja key are runtime, hence unaffected).
    - **Node-runtime `req.url` behind Traefik = the internal `http://localhost:3000`.** `NextResponse.redirect(new URL("/x", req.url))` leaks that host. Use a **relative `Location`** header (`new NextResponse(null, {status:307, headers:{Location:"/x"}})`) so the browser resolves against the real origin. (Middleware/edge already returns relative.)

## Billing cron (schedule this)

Subscription enforcement is real-time (`computeBilling` in `requireCapability` → suspended stores
are read-only immediately, no job needed). But **recurring invoice generation + stored-status
sync** run via `GET /api/cron/billing?secret=$CRON_SECRET` — schedule it **daily**:
- Set `CRON_SECRET` (admin container env; already in the compose).
- Coolify Scheduled Task (or a host crontab): `curl -s "https://<admin-domain>/api/cron/billing?secret=$CRON_SECRET"` at e.g. `0 2 * * *`.
- Returns `{stores, statusSynced, invoicesCreated}`. It generates a VA invoice for past-due/suspended stores with no pending subscription invoice; payment callback then extends the period.

## Env to set in Coolify

See `.env.coolify.example`. Secrets: `POSTGRES_PASSWORD`, `AUTH_SECRET` (change!), `KIRIMINAJA_API_KEY`, `AUTOLARIS_API_KEY`, `AUTOLARIS_CALLBACK_SECRET`. Cross-surface URLs (set AFTER domains assigned): `PUBLIC_APP_URL`, `ADMIN_URL`, `PUBLIC_ONGKIR_API`, `PUBLIC_ORDER_API`.

## 🚀 Going live on `tokophi.com` (when final)

> Currently everything runs on `*.45.77.33.112.sslip.io` (no real domain). `tokophi.com` is bought + its zone is on Cloudflare (2026-07-09), DNS not yet pointed. **The code is env-driven** — going live is DNS + env + redeploy, no code changes. Topology: **Cloudflare edge → Coolify/Traefik (45.77.33.112) → containers**.

**Domain plan** — `tokophi.com` is the **front door / landing page** ("pintu masuk", our own marketing page — **not built yet, TODO**); each surface gets its own subdomain:

| Surface | Hostname | Notes |
|---|---|---|
| **landing / marketing** | `tokophi.com` + `www.tokophi.com` | the platform's own front page ("isi = page kita") — **not built yet** (placeholder / redirect to `app` until then) |
| **client admin** (merchants) | `app.tokophi.com` | merchant login + editors |
| **super-admin** (us) | `rich.tokophi.com` | platform control plane (internal) |
| **storefront** (demo store) | `toko.tokophi.com` | the demo store — a RESERVED label, never a merchant slug |
| **storefront** (per merchant) | **`<slug>.tokophi.com`** | e.g. `batik-nusantara.tokophi.com` — **one deploy serves every store**, resolved from the `Host` header (ADR 0009). Set `STOREFRONT_BASE_DOMAIN=tokophi.com` |

**⚠️ Why `<slug>.tokophi.com` and NOT `<slug>.toko.tokophi.com`** (decided 2026-07-13): Cloudflare **Universal SSL covers only ONE wildcard level** — `*.tokophi.com` ✅, `*.toko.tokophi.com` ❌. The two-level scheme would force either paid **Advanced Certificate Manager** (~$10/mo) or an origin Let's Encrypt **DNS-01** wildcard served **grey-cloud** (which exposes the origin IP and drops CF's protection). The one-level scheme is free, stays **proxied**, and needs **no code change**. Cost: merchant slugs share the apex namespace with our own surfaces — handled in code by `RESERVED` (`www/app/rich/admin/api/cname/toko/storefront/localhost` never resolve as a store slug, in BOTH host rules).

**Steps (in order):**

1. **Cloudflare DNS** — add `A` records for `@`(root), `www`, `app`, `rich`, `toko`, **and `*` (wildcard, for `<slug>.tokophi.com`)** → **`45.77.33.112`**. Start **DNS-only (grey cloud)** so Coolify/Traefik can issue Let's Encrypt certs via HTTP-01; flip to **proxied (orange)** after certs are live. ⚠️ **A wildcard record only gets a CF-proxied cert via Universal SSL when proxied** — LE HTTP-01 cannot issue a wildcard, so the storefront's per-store hosts rely on **Cloudflare's edge cert** (proxied) + whatever origin cert Traefik has; verify a fresh `<slug>.` host over https before calling it done.
2. **Coolify domains** — set the app's `docker_compose_domains` DB field (or per-service Domains in the UI) to the **https** hostnames: `{"admin":{"domain":"https://app.tokophi.com"},"super_admin":{"domain":"https://rich.tokophi.com"},"storefront":{"domain":"https://toko.tokophi.com"}}` (⚠️ super-admin service → underscore key `super_admin`). Redeploy → Traefik requests Let's Encrypt certs. `tokophi.com`/`www` → the (future) landing app, or a redirect to `app` for now.
2b. **Traefik wildcard router for the storefront** — Coolify's Domains field takes explicit hostnames, so `<slug>.tokophi.com` needs a **`HostRegexp`** rule (e.g. ``Host(`toko.tokophi.com`) || HostRegexp(`^[a-z0-9-]+\.tokophi\.com$`)``) added as a Traefik label on the storefront service, and the original **`Host` header must be preserved** (no host rewrite) — the app resolves the tenant from it. The explicit surface hosts (`app.`/`rich.`) keep their own routers, which match first; `RESERVED` in code is the second line of defence.
3. **Storefront env** — `STOREFRONT_BASE_DOMAIN=tokophi.com` (enables `<slug>.tokophi.com` → store) and keep `STORE_SLUG=batik-nusantara` as the fallback so `toko.tokophi.com` / bare-IP hosts still serve the demo store. Optional: `STOREFRONT_CACHE_TTL_MS` (default 15000).
4. **Cross-surface env** (set AFTER domains, then redeploy) — **all four point at the admin domain** (the AutoLaris pay callback `/api/public/pay/callback` + the ongkir/order public APIs all live in the admin app; the storefront is only a consumer): `PUBLIC_APP_URL=https://app.tokophi.com`, `ADMIN_URL=https://app.tokophi.com`, `PUBLIC_ONGKIR_API=https://app.tokophi.com` (storefront also rewrites `/api/uploads/*` media against this), `PUBLIC_ORDER_API=https://app.tokophi.com`.
4. **Harden secrets for prod**: rotate `AUTH_SECRET` (strong random — shared across admin+super-admin for cross-subdomain impersonation, gotcha #11), `POSTGRES_PASSWORD`, `CRON_SECRET`; set the **real** `KIRIMINAJA_API_KEY`/`AUTOLARIS_API_KEY` + `AUTOLARIS_CALLBACK_SECRET` (switch `KIRIMINAJA_ENV` sandbox→production when ready).
5. **AutoLaris callback URL**: the pay callback the gateway hits is `PUBLIC_APP_URL + /api/public/pay/callback` = `https://app.tokophi.com/api/public/pay/callback` (set via `PUBLIC_APP_URL` in step 3; verify it in the AutoLaris dashboard) so paid VAs settle.
6. **Cloudflare after proxied**: SSL/TLS mode **Full (strict)**; **Always Use HTTPS** on; cache rule = **bypass** for `app.` + `rich.` + any `/api/*` (dynamic, cookies), cache static `/_astro/*` + `/products/*` on `toko.`; keep `www → apex` redirect.
7. **Billing cron**: update the Coolify Scheduled Task URL to `https://app.tokophi.com/api/cron/billing?secret=$CRON_SECRET` (daily).
8. **Verify**: `https://toko.tokophi.com` (storefront 200 + a product page + a category), `https://app.tokophi.com/login` (merchant), `https://rich.tokophi.com` (platform), a real login, and an impersonation round-trip (cross-subdomain cookie — gotcha #11). (`https://tokophi.com` → landing page once built.)

**Gotchas that will bite on real subdomains** (already fixed in code, but re-check): cross-subdomain cookies (impersonation via signed token, not a shared cookie); module-scope `process.env` reads baked at build (read env inside functions); Traefik `req.url` = internal host (use relative `Location` on redirects). See gotcha #11 above.

## Local validation before pushing (always)

```bash
docker compose -f docker-compose.coolify.yml -p tokophi-test up -d --build
docker compose -f docker-compose.coolify.yml -p tokophi-test ps        # all up, migrate Exited(0)
docker compose -f docker-compose.coolify.yml -p tokophi-test logs migrate | tail
docker compose -f docker-compose.coolify.yml -p tokophi-test down -v    # cleanup
```
Validated 2026-07-09: migrate+seed OK (7030 areas), admin/super-admin/storefront all serving.

## Migration Vultr → Hetzner (prod), precise steps

Everything is host-agnostic (Coolify + git + `pg_dump` + Cloudflare), so:
1. **Provision Hetzner** Singapore (CCX AMD, e.g. CCX23 4vCPU/16GB), Ubuntu 24.04 — register the Hetzner account early (verification can be slow).
2. Install Coolify (`curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash`) + UFW (22/80/443/8000/6001/6002).
3. In Coolify: same GitHub repo, **Docker Compose** build pack, same `docker-compose.coolify.yml`, set env (real secrets + prod `AUTH_SECRET`).
4. **DB**: `pg_dump` from the Vultr Postgres volume → restore into the Hetzner Postgres (or let `migrate` rebuild schema + re-seed for a fresh prod). For real data: dump/restore.
5. **Cloudflare**: point `app.` / `rich.` / storefront DNS at the Hetzner IP (proxied). SSL via Coolify (Let's Encrypt) or CF. Custom merchant domains → CF for SaaS → `cname.tokophi.com`.
6. Verify, then **destroy the Vultr server** (before credit expiry).

## Domain wiring (when going live)

`tokophi.com` is already in Cloudflare (DNS not pointed yet). Point: `app.tokophi.com` → admin, `rich.tokophi.com` → super-admin, apex/`www` → landing, storefront subdomain/custom. Code is env-driven (`PUBLIC_APP_URL`/`ADMIN_URL`/`PUBLIC_ONGKIR_API`/`PUBLIC_ORDER_API`) → switching = env only.
