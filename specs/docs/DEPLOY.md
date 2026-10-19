# TokoΦ — Deployment Runbook (Docker + Coolify)

> Precise deploy steps + **every gotcha/error we hit and its fix**, so migrating servers
> (Vultr → Hetzner) or re-provisioning is exact. Companion: `PROD_PLAN.md` (decisions),
> `.env.coolify.example` (env). Topology: **Cloudflare edge → Coolify/Traefik (origin) → containers**.

## Current server (2026-07-10; it is PRODUCTION since 2026-07-13) — `volumdev`

> ⚠️ **Billing is a single point of failure on this box — realised 2026-09-04 → 2026-09-07 (~70 h down).** Vultr suspends the instance when the account balance runs out, silently. Runbook below: "Origin unreachable / every host 522".

- **Vultr**, region **Singapore (sgp)**, plan `vhp-4c-8gb-amd` (4 vCPU / 8GB / 180GB NVMe), **Ubuntu 24.04.4 LTS**. ~$48/mo.
- IP **45.77.33.112**; SSH **key-only** (`ssh -i ~/.ssh/tokophi_dev root@45.77.33.112`) — password auth **disabled** (`passwordauthentication no`).
- **Coolify v4.1.2** (`http://45.77.33.112:8000`), server type = **Localhost/This Machine**. UFW active: 22/80/443/8000/6001/6002. app uuid `l7r4qaqcml4zigw1dc7iptun`; **Coolify app id `1`**; instance id `0d341106-34ff-4b5b-8441-9350e1b8ce35`.

⚠️ **The API token is EXPIRED/REVOKED, not missing — do not go and create the file** (re-checked
2026-08-03). `/api/v1` answers `401 {"message":"Unauthenticated."}`, and the conclusion drawn from
that — **no scripted deploy or rollback path today** — is right. The *diagnosis* printed here on
2026-08-01 was not: it said `~/.coolify_token` "does not exist".

```bash
ls -l ~/.coolify_token        # → -rw------- 50 bytes, Jul 10.  It is there.
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $(cat ~/.coolify_token)" http://45.77.33.112:8000/api/v1/applications
# → 401
```

The earlier check almost certainly ran **on the VPS**, where `~` is `/root` and the file genuinely is
absent — it lives on the **workstation**. So the fix is **not** "write the file"; the file is already
written and its contents are dead. **Regenerate it in Coolify → Keys & Tokens** and overwrite it
(`chmod 600`), then re-run the curl above and expect a 200. Until someone does, everything below goes
through SSH + `docker`, and rollback is `git revert` + push + webhook (~8–9 min, see below).
- Provisioned fresh via **`vultr-cli`** + cloud-init (lean base, hardened SSH); Coolify installer auto-installs Docker. This is the **single consolidated box** — the earlier experiment box (`45.76.146.40`) was **deleted**.
- **Domains:** `admin`/`super_admin`/`storefront` on `*.45.77.33.112.sslip.io` via the app's `docker_compose_domains` DB field (Coolify's `SERVICE_FQDN` env magic doesn't wire the compose build pack — set the DB field directly; note the **super-admin** service maps to the underscore key `super_admin`).

## Deploy shape

- **Build pack = Docker Compose** (`docker-compose.coolify.yml` at repo root), NOT Nixpacks.
- Services: `postgres` + one-off `migrate` (Drizzle migrate + seed) + `admin` (:3000) + `super-admin` (:3001) + `storefront` (:4327). Ports are `expose` only → Coolify assigns a domain per service.
- Per-app Dockerfiles (`apps/*/Dockerfile`) build with **context = repo root** (workspaces resolve).
- After first deploy: assign domains per service in Coolify, then set the cross-surface env (below) + redeploy.

## ⚠️ Gotchas / errors hit → fixes (READ before re-deploying or migrating)

1. **Nixpacks / base-directory FAILS on npm workspaces.** Building `apps/admin` alone can't resolve `@tokophi/*`. → **Docker Compose build pack**, each service `build.context: .` (repo root) + `dockerfile: apps/<app>/Dockerfile`.
2. **`next build` throws `[@tokophi/db] DATABASE_URL is not set`.** Next collects data for API routes at build → imports `@tokophi/db`, which in production now defaults to the restricted app-role path unless `DATABASE_RUNTIME_ROLE=owner` is explicit. → Pass a **dummy DATABASE_URL only on the build RUN** (`postgres://build:build@localhost:5432/build`) **and** set `DATABASE_RUNTIME_ROLE=owner`; postgres.js is lazy so nothing connects. Runtime uses the real URL from compose. (In `apps/admin/Dockerfile` + `apps/super-admin/Dockerfile`.)
3. **Storefront (Astro) is SSR** (`@astrojs/node` standalone, `output: 'server'`) — reads Postgres at **server BOOT** (module-level in `src/data/catalog.ts`), NOT at `astro build`. So the image builds WITHOUT a DB (bundling only) and the container starts in **seconds** (`node dist/server/entry.mjs`), eliminating the deploy downtime the old SSG build-at-start caused. Dynamic routes (`produk/[handle]`, `kategori/[handle]`) resolve per-request from `Astro.params` (real + virtual collections; 404 on miss) — **no `getStaticPaths`**. `HOST=0.0.0.0`/`PORT=4327` via env. (Converted 2026-07-10; previously SSG-built-at-start.)
4. **`super-admin` has no `public/` dir** — don't `COPY` it in that Dockerfile.
5. **Migrate step**: the npm scripts wrap commands in `dotenv -e ../../.env`, which has no `.env` in Docker. → Run raw: `cd packages/db && npx drizzle-kit migrate && npx tsx src/seed.ts && npx tsx src/seed-areas.ts`, with `DATABASE_URL` in env. `drizzle.config.ts` reads `process.env.DATABASE_URL` directly. `migrate` reuses the **admin image** (has drizzle-kit + tsx + `packages/db`).
6. **`seed-areas` needs `packages/db/data/kiriminaja-areas.csv`** (400KB, **tracked in git** — Coolify clones from GitHub, so it must be committed). Made non-fatal (`|| echo skipped`) so a hiccup doesn't block the apps.
7. **RLS migration creates the `tokophi_app` role** → the migrate connection must be a **superuser**; the postgres image's `POSTGRES_USER=tokophi` is superuser of its DB, so OK. The repo is now **prepared** for a restricted runtime path (`DATABASE_RUNTIME_ROLE=app` + `APP_DATABASE_URL`), but the canonical deploy must stay on owner `DATABASE_URL` today because `apps/admin` is still a mixed-privilege process: merchant tenant queries use `withTenant()` / `withCurrentTenant()`, while `/api/public/*`, cron routes, and cross-tenant owner reads still use the owner path on purpose. Do **not** connect directly as `tokophi_app` — migration `0012` creates it as `NOLOGIN`.

   ```sql
   create role tokophi_runtime
     login
     password 'replace-me'
     nosuperuser nocreatedb nocreaterole inherit noreplication;
   grant tokophi_app to tokophi_runtime;
   ```

   Verify the future restricted path the same way the app uses it:

   ```sql
   select current_user, session_user;
   select rolname, rolbypassrls from pg_roles where rolname in ('tokophi_runtime', 'tokophi_app');
   begin;
   select set_config('app.store_id', '<store-uuid>', true);
   set local role tokophi_app;
   select count(*) from products;
   rollback;
   ```

   `tokophi_runtime` inherits today's `tokophi_app` grants — not a perfect least-privilege boundary. Platform tables that intentionally stay outside RLS still require the owner path, and the merchant admin cannot switch to `APP_DATABASE_URL` until those owner-only call sites are split onto an explicit second pool. Any future tightening should start by removing unnecessary grants from `tokophi_app`, not by widening more app traffic back onto `DATABASE_URL`.
8. **Images are ~1.7GB** (full `node_modules` + `next start`, not standalone) — deliberate for reliability on a monorepo; disk is 350GB so fine. Optimize to standalone later only if needed.
9. **`.env*` is gitignored** → templates need an allow rule (`!.env.coolify.example` in `.gitignore`).
10. **Vultr has no Jakarta** (SG is closest, ~20-30ms) and **includes IPv4**; **Hetzner charges a small IPv4 fee** and its Asia region is Singapore-only (AMD CPX/CCX, no cloud GPU).
11. **Prod-only multi-subdomain bugs** (worked on localhost, broke on separate subdomains — will recur on Hetzner):
    - **Cross-subdomain cookies aren't shared.** Impersonation (super-admin sets the `session` cookie) failed → the admin (different subdomain) can't read it. Fix pattern: super-admin signs a short-lived token → admin `/impersonate` route verifies (same `AUTH_SECRET`) + sets the cookie on its own domain. On localhost it "worked" because cookies are host-not-port scoped.
    - **Module-scope `process.env` reads get baked at build time** (when the var is unset) for app-local server code → `ADMIN_URL` was frozen to `localhost:3000`. Read env **inside the function** at request time (workspace-package reads like the KiriminAja key are runtime, hence unaffected).
    - **Node-runtime `req.url` behind Traefik = the internal `http://localhost:3000`.** `NextResponse.redirect(new URL("/x", req.url))` leaks that host. Use a **relative `Location`** header (`new NextResponse(null, {status:307, headers:{Location:"/x"}})`) so the browser resolves against the real origin. (Middleware/edge already returns relative.)

## ⏱ Jendela 503 saat deploy — DIUKUR 2026-08-19: **15 menit → 81 detik**

> **PEMBARUAN 2026-08-28 — jendela sekarang 7,0–8,3 detik per surface (−93 %), dan ini keputusan struktural:
> ADR [`0017-zero-downtime-deploy.md`](../decisions/0017-zero-downtime-deploy.md).** Seksi di bawah ini adalah
> catatan pengukuran 2026-08-19 (15 menit → 81 detik) dan tetap benar untuk penyebab PERTAMA (rantai seed di
> jalur kritis). Penyebab KEDUA, yang ditemukan 2026-08-28, berbeda: Coolify meruntuhkan seluruh stack compose
> sebelum menaikkan yang baru (`is_consistent_container_name_enabled` + `depends_on: migrate` membuat urutan
> start serial ~13–20 s), dan retry Traefik TIDAK bisa menjembatani pool kosong (503 dijawab seketika; diukur
> 19,6 / 17,5 / 3,4+19,6 s). Yang dilakukan (`5b7d7c8`, `73c3b51`, `16b72b0`): nama container konsisten, gate
> `migrate` dilepas dari app yang di-routing, healthcheck `start_interval: 2s`. Hasil deploy 524:
> **`app` 8,3 s · `rich` 7,0 s · `toko` 7,3 s**. Dua tuas yang tersisa ada DI LUAR repo (orkestrasi Coolify
> untuk swap tumpang-tindih; image Next yang tidak reproducible sehingga ketiga app selalu ikut swap) dan
> sengaja belum diputuskan — lihat ADR §5. ⚠️ Ambang alarm uptime eksternal (Task 8.1) harus lebih panjang
> dari jendela ini, atau setiap deploy akan membangunkan orang.

Dua pengukuran pada hari yang sama, keduanya dengan probe HTTP tiap 20 detik terhadap
`app.tokophi.com/login` sejak detik merge, bukan dengan membaca log:

| deploy | jendela 503 | isi rantai `migrate` |
|---|---|---|
| `#279` (index + test) | **±15 menit** | migrasi **+ 8 skrip seed**, ketiganya menunggu seluruhnya |
| `#281` (pemisahan ini) | **81 detik** (503 mulai +506 s, pulih +587 s) | migrasi saja; `seed` jalan setelah aplikasi melayani |
| `#283` (Task 4.9) | **nol teramati** — 15 menit probe, tak satu pun sampel 503; container tiba di sha barunya | idem |

Bukti pada deploy kedua, diambil saat itu juga: `migrate` `Exited (0)` 28 detik lalu sementara
`seed` **baru hidup 27 detik** — rantai demo-data memang sudah berada di belakang, bukan di depan.
`landing` 200 sepanjang ketiga deploy (ia tanpa database dan tanpa `depends_on: postgres`).

⚠️ **Baca baris ketiga sebagai "tak teramati", bukan "nol".** Probe-nya mencuplik tiap **15 detik**,
jadi jendela yang lebih pendek dari itu memang tidak akan tertangkap. Yang bisa diklaim: pada
resolusi 15 detik, deploy itu tidak pernah menjawab 503. Variasi 81 detik vs tak-teramati sendiri
masuk akal — ia bergantung pada apakah healthcheck container baru sempat lolos sebelum yang lama
dilepas, dan itu bukan sesuatu yang dijamin oleh susunan sekarang. **Jangan menjanjikan "deploy tanpa
downtime" atas dasar satu sampel bersih**; yang sudah terbukti adalah tiga titik menurun tajam
(15 menit → 81 detik → tak teramati), bukan sebuah jaminan.

🔴 **KOREKSI TERHADAP VERSI PERTAMA CATATAN INI, yang saya tulis sendiri beberapa jam sebelumnya.**
Ia membagi 15 menit itu menjadi "build ~6 menit dengan container lama SUDAH dibongkar" + "migrate ~7
menit". Bagian pertamanya **salah**. Diukur pada deploy `#281`: selama build berlangsung, ketiga host
tetap menjawab **200** — container lama terus melayani, dan 503 baru dimulai pada detik ke-506, yaitu
saat swap. Jadi build TIDAK pernah menyumbang downtime; yang menyumbang hampir seluruhnya adalah
rantai seed yang menahan `service_completed_successfully`.

Kenapa kekeliruan itu terjadi, karena pantas diingat: pengamatan pertama dilakukan SEKALI, di tengah
deploy, dan saat itu container aplikasi memang tidak ada sementara sebuah build baru saja selesai —
dua fakta yang benar, dirangkai menjadi sebab-akibat yang tidak diuji. Yang membedakannya hanyalah
mengukur dari detik nol sampai pulih, bukan memotret satu momen.

**Bentuknya sekarang:** `migrate` menjalankan `drizzle-kit migrate` saja (hitungan detik bila tidak
ada migrasi baru); service `seed` membawa delapan skrip demo/reference, bergantung pada `migrate`,
dan **tidak ditunggu siapa pun**. `depends_on` aplikasi tidak berubah — skema tetap prasyarat.

⚠️ Satu perubahan perilaku, dikatakan terang: pada deploy PERTAMA terhadap database kosong,
storefront bisa naik sebelum baris toko demo ada, jadi healthcheck-nya (`GET /` lewat fallback
`STORE_SLUG`) mungkin melaporkan unhealthy sampai seed selesai — healthcheck mengulang, jadi ia pulih
sendiri satu interval setelah seed rampung. Pada deploy berikutnya barisnya sudah ada.

⚠️ **Baris di §"Storefront (Astro) is SSR" di atas benar dan sekarang terbukti**: proses node memang
naik dalam hitungan detik, dan setelah pemisahan ini jendela yang dirasakan merchant memang mendekati
biaya swap itu sendiri (81 detik: stop, start, healthcheck pertama).

Sisa 81 detik itu bukan lagi milik rantai seed. Menekannya lebih jauh berarti swap yang tumpang-tindih
(container baru sehat dulu, baru yang lama dimatikan) — itu orkestrasi Coolify, bukan berkas compose
ini, dan belum dikerjakan. Sebelum ada yang mencobanya: **ukur dulu**, dengan cara di tabel atas.

## 🔴 Origin unreachable / every host 522 — the diagnosis ladder (used 2026-09-07)

Cloudflare **522** on `tokophi.com`, `app.`, `rich.`, `toko.` AND `<slug>.tokophi.id` at once means the
**origin** is gone, not a container — one bad container gives a 503 on ONE host, and the landing has
no DB and would still serve. Walk the ladder top-down; each step rules out the cheaper cause.

1. **Confirm it is every host, from off the box** (a single-host failure is a different runbook):
   ```bash
   for h in tokophi.com app.tokophi.com rich.tokophi.com toko.tokophi.com; do
     printf '%-22s ' "$h"; curl -s -o /dev/null -w '%{http_code}\n' --max-time 15 "https://$h/"
   done
   # 522 on all four = origin unreachable. (rich. → 307 is HEALTHY; toko. → 200; app. → 307 to /login.)
   ```
2. **Is the box alive at all?** `ping -c 3 45.77.33.112` and `ssh -i ~/.ssh/tokophi_dev root@45.77.33.112 uptime`.
   Ping dead + SSH timing out (not "connection refused") ⇒ the VM itself is stopped, not the daemon.
3. **Ask the hosting provider, not the server.** `vultr-cli instance list` (the CLI is configured via
   `~/.vultr-cli.yaml` on the owner's machine — nowhere else, and not on the VPS). Read the
   `STATUS`/`POWER` columns. On 2026-09-07 it said **`suspended`**: the account balance had gone
   negative and Vultr powered the instance off at **2026-09-04 20:27 WIB**. That is a **billing**
   state; no amount of `docker` will fix it and nothing on the box logged anything.
4. **If `suspended`: top up the balance in the Vultr console.** The instance **auto-resumes** after
   the payment clears (measured: back at 2026-09-07 18:47 WIB, ~70 h 20 min after the stop). Do NOT
   `vultr-cli instance start` first and do NOT redeploy from Coolify while it is suspended — the
   webhook queues a build against a box that cannot receive it.
5. **After resume, verify in this order** — the box boots everything with `restart: unless-stopped`,
   so most of it comes back by itself, but "up" is not "serving":
   ```bash
   ssh -i ~/.ssh/tokophi_dev root@45.77.33.112 'docker ps --format "{{.Names}}\t{{.Status}}" | sort'
   # want: all 18 containers Up (healthy) — postgres, admin, super-admin, storefront, landing, cron*,
   #       backup, backup-offsite (unhealthy is EXPECTED there until R2 is credentialed), coolify-*.
   ```
   then the four-host curl loop from step 1 (want 200/307), then `coolify-sentinel` — it restarts on
   its own; if Coolify's UI (`:8000`) does not answer within a few minutes, `docker ps | grep coolify`
   before touching anything. Finally drive **one shopper path in a real browser** (checkout →
   kecamatan search returning rows), because a healthy container is not a working product (§L2).
6. **What the suspension does NOT do:** it does not lose the Postgres volume (data was intact; last
   dump before the stop 2026-09-04 11:50 UTC), it does not rotate any env, and it does not change the
   egress IP. **What it DID break beside the outage:** the KiriminAja sandbox began refusing our IP —
   next section. Record the window in `SLA-DRP.md` §2 and `STATUS.md`.

**The gap this exposed** (tracked in `SLA-DRP.md` §6): nothing off-box watches the origin (`ops/tokophi-probe.sh`
is built but installed nowhere), and there is no Vultr low-balance alert or auto-top-up, so a billing
lapse is a silent multi-day outage. The probe would have caught it in 15 minutes.

## 🔴 KiriminAja 401 after a restart — "Your IP address … were not allowed to access this API"

Symptom on production: checkout renders, kecamatan search works (that is Postgres), but **no rates
appear** and `/api/public/ongkir` `op:"rates"` answers `SHIPPING_QUOTE_UNAVAILABLE`. The shopper-facing
string is deliberately ours (ADR 0004); the vendor's is in the admin container's `console.error`.

Probe **from inside the admin container**, where the key already lives — never paste the key into a
shell, a ticket or this file:
```bash
A=$(docker ps --format '{{.Names}}' | grep -m1 '^admin-')
# 1. What does the vendor say to OUR key from OUR box?  (province is a POST with a {} body)
docker exec "$A" node --input-type=module -e 'const r=await fetch("https://tdev.kiriminaja.com/api/mitra/province",{method:"POST",headers:{Authorization:"Bearer "+process.env.KIRIMINAJA_API_KEY,"Content-Type":"application/json"},body:"{}"}); console.log(r.status, await r.text())'
# 2026-09-07: 401 {"status":false,"text":"Your IP address 45.77.33.112 were not allowed to access this API",...}
# 2. Which IP does the vendor actually see?  (must equal the VPS IP; if not, something is proxying egress)
docker exec "$A" node --input-type=module -e 'console.log(await (await fetch("https://api.ipify.org")).text())'
# 2026-09-07: 45.77.33.112
# 3. Is the key even set / which env?  (prints presence and length only — NEVER the value)
docker exec "$A" node -e 'console.log(process.env.KIRIMINAJA_ENV||"unset(=sandbox)", "key:", process.env.KIRIMINAJA_API_KEY?process.env.KIRIMINAJA_API_KEY.length+" chars":"MISSING")'
```
Reading the three answers: **401 with that text + egress = VPS IP + key present** ⇒ the **sandbox
IP allow-list** on the KiriminAja developer portal no longer contains `45.77.33.112`. That is an
**owner action on the vendor portal** (or a support ticket to KiriminAja); nothing in this repo can
fix it, and `Super Admin → Pengaturan → "Tes koneksi" KiriminAja` will report the same 401 with the
env name. Swap `tdev.` for `client.` in the probe when `KIRIMINAJA_ENV=production`.

⚠️ **Do NOT press the AutoLaris "Tes koneksi" button as a casual health check.** `alTestConnection`
(`packages/lib/src/autolaris.ts`) proves connectivity by **creating a real Rp10.000 QRIS bill**
(`PING-…`, channel `QRIS`, `amount: 10000`) and reading `rc=00`. It is an authorised action, not a
ping. The KiriminAja test is read-only (province list) and safe.

## L1 self-healing watchdog (LIVE on `volumdev` since 2026-07-15)

On 2026-07-14 production 503'd because Coolify built the app containers, left them `created`, and moved
on — nothing started them, nothing told us. The watchdog is the automatic recovery for exactly that
(failure shape #1). It lives on the **host** (not in a container) so it survives a bad deploy.

- **Source of truth:** `ops/tokophi-watchdog.sh` in the repo. Installed at
  `/usr/local/bin/tokophi-watchdog.sh`; run every minute by `/etc/cron.d/tokophi-watchdog`
  (`* * * * * root /usr/local/bin/tokophi-watchdog.sh`).
- **What it does:** `docker start`s any of the 4 app containers (`admin`, `super-admin`, `storefront`,
  `landing`) found in `created`/`exited`, matched by the stable `<svc>-l7r4qaqcml4zigw1dc7iptun-` prefix
  (the trailing hash changes every deploy). It **never** touches `postgres`/`backup`/`coolify`/`cron`, and
  **never `migrate`** (which is *supposed* to be `exited (0)` — starting it would re-run migrations). Only
  `created`/`exited` are acted on; a `running`-but-unhealthy or `restarting` crash-loop is left for L2/L3.
- **Liveness:** writes `/var/run/tokophi-watchdog.last` every run (the log is quiet on a healthy box, so
  that file is how you tell the watchdog itself is alive — check its mtime). Actions log to
  `/var/log/tokophi-watchdog.log` (`HEAL …`).
- **Reinstall (after a full VPS reprovision — a normal deploy does NOT wipe it):**
  ```bash
  scp ops/tokophi-watchdog.sh root@<box>:/usr/local/bin/tokophi-watchdog.sh
  ssh root@<box> 'chmod 755 /usr/local/bin/tokophi-watchdog.sh
    printf "%s\n" "* * * * * root /usr/local/bin/tokophi-watchdog.sh" > /etc/cron.d/tokophi-watchdog
    chmod 644 /etc/cron.d/tokophi-watchdog'
  ```
- **Verify:** `ssh root@<box> 'cat /var/run/tokophi-watchdog.last'` should be < 1 min old; a
  `docker stop landing-…` then a manual `/usr/local/bin/tokophi-watchdog.sh` must bring it back with a
  `HEAL` line.
- **Still open:** L2 (off-box probe incl. a DB-touching endpoint) + L3 (Coolify deploy-failure alarm) +
  an alert channel — see BACKLOG P1.8. They are blocked on the user's alert-channel decision (Telegram/SMTP).

## L1b disk-cleanup safety-net (LIVE since 2026-07-18)

On 2026-07-18 the storefront 503'd for ~2h while admin/super-admin/landing stayed up. Root cause was
**not** a bad deploy: **the disk hit 100%** (Coolify keeps every per-deploy image — 204 images / ~129 GB),
so **Postgres crash-looped** — WAL recovery finished but the end-of-recovery checkpoint could not write
(`PANIC: could not write to file "pg_logical/replorigin_checkpoint.tmp": No space left on device`),
Postgres reinitialised, and every query returned `the database system is in recovery mode`. The
storefront reads Postgres on every request, so it went `Up (unhealthy)` → 503. The Coolify API itself
500'd (it could not write either). **This is exactly the L2/L3 gap the watchdog names: a
running-but-unhealthy container, not a `created`/`exited` one — the watchdog cannot heal it.**

- **Fix that day:** `docker builder prune -af` + `docker image prune -af` (freed ~130 GB, 100% → 14%).
  **Postgres completed its checkpoint the instant space appeared and came up on its own — no restart, no
  data loss** (WAL replay is idempotent; the PANIC was *before* the write). ⚠️ **Never prune volumes** —
  the Postgres data lives there (`docker builder/image prune` never touch volumes; `system prune --volumes` would).
- **When it 503s and the containers show `Up (unhealthy)`, check DISK FIRST:** `ssh root@<box> 'df -h /'`
  + `docker logs <postgres> --tail 20`. Full disk + "in recovery mode" ⇒ free space (prune), **do NOT
  redeploy** — a redeploy has to BUILD, which needs the disk it does not have.
- **Reduce the source, not just the residue (LIVE since 2026-08-05):** the production application's
  Coolify Watch Paths is `!**/*.md`. Coolify's exclusion-only semantics deploy every non-Markdown
  change, so code, migrations, Compose, Dockerfiles, and ops still deploy; a Markdown-only commit does
  not. Measured before enabling it: 8 of 17 pushes in one day changed only Markdown, but each rebuilt
  all five app images. Verified against the matcher in the installed Coolify 4.1.2: Markdown-only =
  skip, code-only = deploy, mixed Markdown + code = deploy. Remove this exclusion if Markdown ever
  becomes a runtime/build input rather than documentation.
- **Prevention (installed):** `ops/tokophi-docker-cleanup.sh` → `/usr/local/bin/tokophi-docker-cleanup.sh`,
  run hourly at minute 17 by `/etc/cron.d/tokophi-docker-cleanup`. Normal mode prunes build cache older
  than 24h and UNUSED images older than 48h. At **≥70% used OR <25 GB free**, it first prunes all unused
  build cache and measures the disk again; only persistent pressure removes all unused images. This
  keeps rollback images when the cheaper cache cleanup is enough. `flock` prevents a manual cleanup
  and cron from overlapping. It never touches volumes or images attached to a container. Logs to
  `/var/log/tokophi-docker-cleanup.log`.
  ✅ **Repo copy = the box again (2026-08-12, same day the gap was found):** the tracked
  `ops/tokophi-docker-cleanup.sh` is now the byte-for-byte copy of the live hourly two-stage script
  (`17 * * * *`, `AGGRESSIVE_PCT=70`, `MIN_FREE_GB=25`, `flock`), fetched read-only from the box.
  For a few hours it was the older daily/80% version while the live one had never been committed —
  the `scp` below would have DOWNGRADED the box; that window is closed and the command is safe again.
  ```bash
  scp ops/tokophi-docker-cleanup.sh root@<box>:/usr/local/bin/tokophi-docker-cleanup.sh
  ssh root@<box> 'chmod 755 /usr/local/bin/tokophi-docker-cleanup.sh
    printf "%s\n" "17 * * * * root /usr/local/bin/tokophi-docker-cleanup.sh" > /etc/cron.d/tokophi-docker-cleanup
    chmod 644 /etc/cron.d/tokophi-docker-cleanup'
  ```
- **Alternative, not an addition:** Coolify's own threshold-based "Docker Cleanup" can replace this
  cron after its exact image/cache/volume scope is verified. Do not run both: Coolify does not take
  this script's lock, so two cleaners could overlap. Disable the cron first, and never enable volume
  pruning.

## L2 — external probe (BUILT 2026-07-20; **not installed anywhere yet — no alert channel**)

L1 restarts `created`/`exited` containers. L1b sweeps the disk. Neither is a **witness**: on 2026-07-18
the storefront 503'd for ~2h while its container reported `Up (unhealthy)` — a state L1 deliberately
ignores — and the only reason anyone found out is that a human happened to look. `ops/tokophi-probe.sh`
is that witness.

- **It must run OFF the box.** A watchdog on a dead box is worthless; the box itself was the failure
  last time. Run it from a laptop, a second cheap VPS, or a CI runner — anywhere with `curl` + `ssh`.
  **Do not install it on `volumdev`.**
- **Four checks, one per observed failure shape:**
  1. **The 5 public surfaces** — `tokophi.com`, `app.tokophi.com/login`, `rich.tokophi.com`,
     `toko.tokophi.com`, `batiknusantara.tokophi.id`. ⚠️ `rich.` answers **307** (middleware redirect
     to `/login`) and that is **healthy** — a probe demanding 200 there would be red forever and
     everyone would learn to ignore it. Redirects are not followed: the 307 *is* the evidence.
  2. **`POST /api/public/ongkir {"op":"search","q":"Semarang"}`** — the only check that proves
     **Postgres** is alive. It runs `resolveArea()` → an ILIKE over `kiriminaja_areas`; if the DB is
     in recovery the query throws and the route returns 500. A static 200 from a `healthy` container
     proves nothing — that is exactly what was true for two hours. ⚠️ Uses `op:"search"`, **not**
     `op:"rates"`: `7cc1ecc` made a missing `storeSlug` fatal on `rates`, which would 400 on tenant
     resolution and be misread as "down". `search` takes no slug. The check judges the **body**
     (`ok:true` + rows), because an unset `KIRIMINAJA_API_KEY` returns HTTP **200** with
     `{ok:false,"Shipping belum dikonfigurasi."}` — a different problem with a different runbook, and
     the message says which.
  3. **Disk % + free GB over ssh** — the actual leading indicator of 2026-07-18, which nothing watched.
     Alerts at **≥65% used OR <25 GB free**, before `tokophi-docker-cleanup.sh` becomes aggressive at
     70%. This leaves an investigation window even after the probe's three-pass debounce. The free-space
     floor covers a burst of five-service builds (images are ~1.7 GB each, gotcha #8) — below that the
     box is losing the ability to build its own repair, and remember you
     **cannot redeploy your way out of a full disk**.
  4. **L1 heartbeat freshness** — `/var/run/tokophi-watchdog.last`, stale >10 min (10 missed cron ticks)
     ⇒ the watchdog itself is dead. Unhealthy containers are collected from `docker ps` as *context*
     attached to other alerts, never as an alert of their own (a container is briefly unhealthy on
     every deploy).
- **It alerts only after 3 consecutive failing passes** (`TOKOPHI_PROBE_FAIL_THRESHOLD`). At a 5-minute
  cron that is ~15 min of sustained failure before anyone is woken — deliberate. **A probe that cries
  wolf gets ignored:** `verify-rls` was red for weeks, everyone scrolled past it, and two real tenant
  leaks shipped through an alarm that was technically on. Every failing pass still prints immediately;
  only the *page* waits. Recovery after an alert is announced too — silence is indistinguishable from a
  dead probe.
- **Exit code:** `0` = everything healthy, `1` = something is failing (usable as a CI/uptime check).

```bash
# On the OFF-BOX machine — every 5 minutes:
scp ops/tokophi-probe.sh <probe-host>:/usr/local/bin/tokophi-probe.sh
chmod 755 /usr/local/bin/tokophi-probe.sh
printf '%s\n' '*/5 * * * * root . /root/.config/tokophi-probe.env; /usr/local/bin/tokophi-probe.sh >> /var/log/tokophi-probe.log 2>&1' \
  > /etc/cron.d/tokophi-probe && chmod 644 /etc/cron.d/tokophi-probe

# Manual run (HTTP-only, no ssh key on this machine):
TOKOPHI_PROBE_SKIP_SSH=1 ops/tokophi-probe.sh
```

Env (all optional, all with defaults; the alert-channel secrets belong in that sourced env file or
`~/.config/ai-local/secrets.env` — **never in the repo**): `TOKOPHI_SSH_TARGET`, `TOKOPHI_SSH_KEY`,
`TOKOPHI_PROBE_STATE`, `TOKOPHI_PROBE_FAIL_THRESHOLD`, `TOKOPHI_PROBE_DISK_PCT`,
`TOKOPHI_PROBE_DISK_FREE_GB`, `TOKOPHI_PROBE_HEARTBEAT_AGE`, `TOKOPHI_PROBE_SKIP_SSH`,
`TOKOPHI_ALERT_CHANNEL`.

- ⚠️ **`notify()` IS STILL A STUB — this probe cannot page anybody yet.** The alert channel is an
  unmade decision (BACKLOG P1.8): Telegram (fastest to a phone; `@BotFather` token + chat id) or
  email/SMTP. Both are sketched in commented-out code in the script; pick one, uncomment it, set
  `TOKOPHI_ALERT_CHANNEL` plus its secrets in the environment. **Until then the probe writes to stdout
  and the log only** — it is a witness that cannot shout, which is still strictly better than the
  nothing that was there before, and strictly worse than a witness.
- **Verified 2026-07-20:** one full pass against live production — all 5 surfaces + the DB endpoint +
  ssh + disk (20% used, 129 GB free, i.e. L1b's cleanup is holding) + the L1 heartbeat (35 s old), exit
  0. The failure/threshold/recovery path was exercised separately against a dead port, which is how the
  two bugs in it were found: `bash -n` and a single green production pass both said it was fine while
  every check was writing to its **neighbour's** counter, so nothing could ever reach the threshold.
  Same lesson as `queueSave` — **exercise it, do not typecheck it.**

## Billing cron (scheduled — the `cron` service in the compose. **Do NOT add a second schedule.**)

Subscription enforcement is real-time (`computeBilling` in `requireCapability` → suspended stores
are read-only immediately, no job needed). But **recurring invoice generation + stored-status
sync** run via `GET /api/cron/billing` **with `x-cron-secret: $CRON_SECRET` in a HEADER**, and the thing that calls it is the
`cron` **sidecar** in `docker-compose.coolify.yml`, alongside `cron-tracking` /
`cron-tracking-events` / `cron-order-expiry` / `cron-domains` / `cron-payment-advice` (six loops as of
2026-09-11 — `cron-auth.test.ts` counts them, and Super Admin → Analitik → Sistem lists every one). This heading used to read *"schedule this"* and told you to add a **Coolify
Scheduled Task** — following that would have created a **second** caller. Verified 2026-08-03:
`select count(*) from scheduled_tasks` in `coolify-db` is **0**; the sidecar is the only scheduler
and always has been.
- `CRON_SECRET` is set in the admin container (checked live: present, 40 chars) — the route
  **fails closed** without it in production, so an unset one is a 401 on every run, not a free pass.
- 🔴 **IT TRAVELS IN A HEADER, AND `?secret=` NO LONGER AUTHENTICATES ANYTHING** (Task 4.13 / SEC-16,
  2026-08-21). All five sidecars used to put `CRON_SECRET` on the URL, which puts it in the
  container's `command`, in `docker inspect`, in `docker top`, in the host's process table and in the
  access log of anything that proxies the request — for the one credential that authorises a
  state-mutating sweep across **every tenant**. The compose commands now send
  `wget --header "x-cron-secret: $CRON_SECRET"`, and the routes read the header only. `?every=` stays:
  it is the cadence the Sistem panel derives its staleness threshold from, not a credential.
  ⚠️ **Both halves ship in ONE commit and land in ONE deploy, and the order inside that deploy is not
  guaranteed.** If a sidecar restarts before the admin container does, its header is accepted by the
  old code too (it already read the header first), so that direction is safe. The other direction —
  new admin, sidecar not yet restarted — costs **one tick**, logged as
  `a cron credential arrived as a QUERY PARAMETER — refused`. Every job here is idempotent and
  forward-only, so a skipped tick is a delay, never a wrong state. If you see that line persisting
  past the deploy, a sidecar did not restart.
- Returns `{stores, statusSynced, invoicesCreated}`. It generates a VA invoice for past-due/suspended
  stores with no pending subscription invoice; the payment callback then extends the period.

**Verify it ran** — `docker logs --timestamps $(docker ps --format '{{.Names}}' | grep -m1 '^cron-l7r4')`
(prefix, never a full name — the hash changes every deploy). You should see one
`[cron-billing] <iso>` line per run followed by that JSON.
- ⚠️ **Before 2026-08-03 that log was EMPTY, on a healthy box and on a broken one alike.** The command
  was `wget -qO- … >/dev/null 2>&1 || echo 'cron billing failed'` — the body was discarded, so a run
  that invoiced nothing and a run that invoiced every merchant were indistinguishable, and the only
  way to prove the job had fired at all was `docker top` (a `sleep 86400` whose elapsed time matched
  the container's). `cron-tracking` and `cron-tracking-events` already carried a comment recording
  exactly this lesson; the billing job was the one that had not learned it. Body → STDOUT now.
- The container being `Up (healthy)` proves nothing about the job: the healthcheck is `kill -0 1`,
  i.e. "`sh` has a PID". Read the log, not the state.

### ⚠️ The billing schedule is the DEPLOY schedule, and nothing watches this container

Two facts to hold together before anyone "fixes" either one:

1. **`sleep 86400` re-anchors to container start.** Every redeploy restarts the loop *and fires a
   billing run immediately*, so the billing hour is wherever a merge happened to land. Measured from
   `application_deployment_queues`: **13 deploys on 2026-08-03, 18 on 07-30, 24 on 07-23** — the
   86 400 s sleep has almost never been the thing that triggered a run. There is no fixed hour, and
   a day can hold a dozen runs or (over a quiet weekend) exactly one.
2. **It does not double-invoice today, and the reason is in the ROUTE, not here.**
   `billing/route.ts` skips any store that already has a `menunggu` `subscription` invoice. Measured
   against production: **at most one subscription invoice exists on any single day**, including the
   18-deploy one. That guard is load-bearing — do not "simplify" it.
   ⚠️ But it is a **check-then-act with no lock and no idempotency key** (`invoices.number` is unique,
   yet it is `Date.now().toString().slice(-9)` — a timestamp, not a natural key, and three different
   call sites mint it). It holds for **sequential** re-runs. Two genuinely **concurrent** runs — an
   old sidecar still in `wget` while the new one starts — would both read "no pending" and both
   `alCreatePayment` + insert. The window is sub-second and unobserved, not closed.

**Fixing this properly is a project, not a compose line** (~½–1 day): a fixed wall-clock trigger
(Coolify Scheduled Task *replacing* the sidecar, or `supercronic` in it), a `unique (store_id, period)`
idempotency key on the subscription invoice so a repeat is a DB no-op rather than a race, and an
advisory lock around the walk. Do **not** half-build it by putting `$(( 86400 - $(date +%s) % 86400 ))`
in the compose string: that pins the hour without removing the run-on-start, so it changes when the
double-run happens and not whether it can.

### Nothing notices if a cron sidecar dies

- **L1 (`ops/tokophi-watchdog.sh`) deliberately excludes them** — `SERVICES="admin super-admin
  storefront landing"`, and the comment says it "NEVER touches postgres / backup / coolify / cron".
- `restart: unless-stopped` covers a **crash**, and nothing else. It does **not** cover the failure
  shape this box has actually produced: Coolify leaving a container in state `created` and moving on.
  That happened again on **this** deploy — `/var/log/tokophi-watchdog.log`, 2026-08-03 15:03, healed
  `admin`, `super-admin` and `storefront` from `created`. Had the three `cron-*` containers landed
  the same way, **nothing would have started them and nothing would have said so**, and billing +
  AWB polling + conversion delivery would have been off until a human looked.
- **L2 (`ops/tokophi-probe.sh`) does not check them either** — its four checks are the 5 public
  surfaces, `POST /api/public/ongkir`, disk, and the L1 heartbeat. And `notify()` is still a stub, so
  it cannot page anyone regardless.
- **Smallest real fix (not done here, BACKLOG P1.8):** add `cron cron-tracking cron-tracking-events`
  to the watchdog's `SERVICES`. It is safe for exactly the reason `migrate` is not — these loops are
  idempotent restarts of a poller, whereas starting `migrate` re-runs migrations. It is a change to a
  file that lives on the **VPS**, deployed by `scp`, so it does not ride a git deploy and is out of
  scope for a repo-only change.

## Tracking cron (scheduled — `cron-tracking` in the compose)

`GET /api/cron/tracking` **with `x-cron-secret: $CRON_SECRET` in a HEADER** pulls KiriminAja for orders that are **booked but not
finished** (`ka_order_id IS NOT NULL` ∧ status ∈ `diproses`/`dikirim`), fills `orders.awb` the moment
the courier issues it, and advances the order to match the courier. Returns
`{scanned, advanced, awbFilled, errors}`.

**It has its own sidecar (`cron-tracking`, every 15 min), NOT a second line in the daily `cron`
container.** A booking returns `awb: null` — the waybill exists only once a courier accepts the
pickup, which takes minutes to hours. A shopper waiting on a resi cannot wait a day, and the whole
shipping chain queues behind it: **Pengiriman Massal has nothing to print until an AWB exists**. The
endpoint shipped complete (`db10557`) with nothing scheduling it; a poller that never runs is an AWB
that never lands.

Safe to re-run: the sweep is capped at 100 per tick (each item is a live KiriminAja call — a bigger
sweep risks rate-limiting) and `syncOrderFromKa` moves an order **forward only**, so a missed or
replayed tick costs a delay, never a wrong state. Fails closed on an unset `CRON_SECRET` in
production, exactly like billing.

⚠️ `KIRIMINAJA_ENV` still defaults to **sandbox**. The poller will faithfully track sandbox parcels
and report `awbFilled: 0` forever against real ones.

## Conversion cron (scheduled — `cron-tracking-events` in the compose) — ADR 0012

`GET /api/cron/tracking-events` **with `x-cron-secret: $CRON_SECRET` in a HEADER** drains `tracking_event_deliveries` into the
merchant's own Meta Conversions API / GA4 Measurement Protocol / TikTok Events API. Returns
`{ok, claimed, sent, failed, dead, released, backfilled}`.

**It PURGES and RECONCILES before it claims, and those last two counters are the ones to watch:**
- `released` — held rows whose order has since become `financial_status='dibayar'` (≤7 days). A prepaid
  conversion is parked at `2126-01-01` and released by the AutoLaris webhook, which is a **single
  un-retried delivery**: get the callback secret wrong on a redeploy and every prepaid Purchase in that
  window sits parked forever. There is no payment poll and no "mark paid" path in the product.
- `backfilled` — orders ≤3 days old with **no** delivery row at all, where the store has a usable CAPI
  config and the order is either paid or COD (cancelled/returned/refunded excluded — this sweep must
  never invent a conversion). `enqueuePurchase` runs after the order commits inside a try/catch; one
  transient DB blip and the conversion is lost silently, and the browser pixel is suppressed with it.
  Capped at 20 per tick, each order in its own try/catch so one bad row cannot block the sweep.
- Retention: rows older than **30 days are deleted** on every tick, 500 at a time. They carry the
  shopper's IP, UA and ad cookies, and past every provider's own event window they are only evidence.

A `released` or `backfilled` that is persistently non-zero is **not** "the cron working" — it is the
payment callback or the checkout enqueue failing upstream. Both sweeps carry `store_id` explicitly on
every predicate: this route runs on the owner connection, where RLS does not apply.

**Its own sidecar, every 60 s** — not a line in the daily `cron` container. A conversion delivered an
hour late still counts, but the ad platform's optimisation degrades with delay, and Purchase is a
low-volume high-value event: a tick with nothing due returns immediately, so the interval costs a query,
not an API call. Retries carry their own backoff **inside** the endpoint (attempt² minutes + jitter,
6 attempts, then `dead_letter`), so the loop is never the retry rate. A tick claims at most **50** rows
(50 × the 10 s per-call timeout ≈ 8 min, comfortably inside the 30-minute stranded-row window — keep
that inequality true if you change either number).

**Two env vars, both mandatory for this to do anything:**
- `CRON_SECRET` — same one as billing/tracking; **fails closed in production** when unset.
- **`INTEGRATION_TOKEN_KEY`** — ≥16 chars, the AES-256-GCM key for `capi_token_ciphertext`
  (`apps/admin/lib/crypto.ts`). Without it the Seller **cannot save a CAPI token at all** (the action
  refuses rather than storing plaintext), and any already-stored token becomes undecryptable → those
  deliveries dead-letter as `not_configured` with a merchant-readable message. **Rotating it** = add a
  `v2:` branch in `crypto.ts` that decrypts `v1:` with the old key and re-encrypts; there is no
  in-place rotation, and simply changing the value silently invalidates every stored token.

Safe to re-run: the claim is one atomic `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)`, so two
overlapping ticks cannot take the same row; the row's `unique(store_id, channel, event_id)` plus the
provider's own `event_id` de-duplication mean a replayed tick cannot double-count a sale. A `processing`
row older than 30 min is re-claimed, so a crashed tick does not strand a conversion.

Optional: `META_GRAPH_API_VERSION` (defaults to a pinned version in `lib/capi.ts`) — bump it in ONE
place when Meta deprecates a version.

## ⚠️ How to verify a deploy ACTUALLY landed (read before reporting one as done)

**Merging to `main` triggers Coolify via webhook. The merge is not the deploy** — the build takes
several minutes, and during that whole window the OLD containers are still up, still `healthy`, and
still serving 200s. Every signal you would naturally check says "fine" while the new code is nowhere
near production.

**Do not verify with container health or HTTP status. Verify that the ARTEFACT CHANGED.**

### ✅ The artefact check that has no false green: the image tag IS the commit sha

**Read this before the `RunningFor` method below, which it supersedes** (verified 2026-08-01 shipping
`2399ea5`). Every image is tagged with the **full git sha**:

```
l7r4qaqcml4zigw1dc7iptun_admin:2399ea509f7057f41f249bb78a22cb3a663a5543
```

So "has my commit landed?" is a string compare against `git rev-parse origin/main` — exact, per
container, and impossible to fool with a partial swap or with deployment N finishing while N+1 builds:

```bash
WANT=$(git rev-parse origin/main)          # after: git fetch origin
ssh -i ~/.ssh/tokophi_dev root@45.77.33.112 \
  "docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}' \
   | grep -E '^(admin|super-admin|storefront|landing)-l7r4qaqcml4zigw1dc7iptun-'" \
| awk -v w="$WANT" -F'\t' '{split($2,a,":"); if (a[2]==w && $3 ~ /healthy/) n++} END{print n"/4"}'
```

**Require `4/4` on TWO consecutive polls** — Coolify swaps services one at a time, so a single 4/4 can
still be a false green. Poll every 45–60 s.

⚠️ `app.` and `rich.` answering **307** is healthy (middleware → `/login`). Demanding 200 there is a
permanently-red check.

### How long a deploy takes — and why the number you read is usually two numbers

⚠️ **`finished_at − created_at` is WEBHOOK-TO-LIVE, not build time.** `created_at` is when the webhook
queued the deployment; there is no `started_at` column. Coolify serialises deploys **per application**,
so anything already running for app `1` is pure waiting time folded into that subtraction. Re-derive
the split rather than reading the total:

```bash
ssh -i ~/.ssh/tokophi_dev root@45.77.33.112 'docker exec -i coolify-db psql -U coolify -d coolify -P pager=off -c "
with q as (select id, application_id, left(commit,7) sha, created_at, finished_at,
                  lag(finished_at) over (partition by application_id order by id) prev_fin
             from application_deployment_queues where status = '"'"'finished'"'"')
select id, sha, extract(epoch from (finished_at-created_at))::int total,
       extract(epoch from (finished_at - greatest(created_at, coalesce(prev_fin, created_at))))::int build_secs,
       extract(epoch from (greatest(created_at, coalesce(prev_fin, created_at)) - created_at))::int wait_secs
  from q where application_id = '"'"'1'"'"' order by id desc limit 15;"'
```

⚠️ **`where application_id = '1'`** — that table is SHARED with **Formalin, which is app id `2`** on
this same box. Omit the filter and you are averaging two different products' builds.

**The build itself is ~8–9 minutes and remarkably stable** (re-derived 2026-08-03 over **all 37**
finished app-`1` deploys since 2026-07-30): the spread is 470–597 s, but **34 of the 37 sit between
470 s and 528 s — 7m50s to 8m48s — with a median of 508 s = 8m28s.** Budget **8m30s ± 30s**, and treat
anything past ~9 minutes as a signal, not noise. (The three above the band: 532 s and 543 s on
2026-07-30, and the 597 s outlier below.)

**Everything above that band has a cause, and it is never the code:**

| id | sha | wall-clock | actual build | cause |
|---|---|---|---|---|
| 322 | `dd2129d` | 9m57s | 9m57s | **Formalin (app `2`, queue 323) built 06:10:14–06:15:01, inside this window.** Different apps do NOT serialise — they share 4 vCPUs. |
| 317 | `d11a96d` | 14m36s | **7m50s** | queued behind 316 → 6m46s of waiting |
| 318 | `d11a96d` | 20m47s | **7m57s** | queued behind 317 → 12m50s of waiting |
| 330 | `52ef1de` | **15m37s** | **8m32s** | queued at 03:01:47 while 329 was still building; started 03:08:52 → **7m05s of waiting** |

So the old line here ("8–10 minutes … five clean builds: 8m28s, 9m57s, 7m57s, 8m36s, 8m32s") was
citing real durations but two things about it misled: **it did not say the five were queue-free**, and
**9m57s was not clean at all** — that is 322, contending with a Formalin build. The genuinely clean
five are 8m28s, 7m57s, 8m36s, 8m32s, 8m29s.

**The practical rule this replaces "8–10 minutes" with:** a deploy that has the queue to itself is
live ~8m30s after the merge. A deploy that does not is `8m30s + however long the one in front of it
has left` — 330 is the worked example, and it is the case CLAUDE.md's *"merge, watch the deploy land,
then let the next one go"* exists to prevent. If a deploy feels slow, look at the queue before you
look at the Dockerfile.

### The older `RunningFor` method — still true, but weaker

```bash
# BEFORE merging — record the running container id
ssh -i ~/.ssh/tokophi_dev root@45.77.33.112 "docker ps -q --filter name=admin- | head -1"

# AFTER — the deploy has landed only when that id is REPLACED
ssh -i ~/.ssh/tokophi_dev root@45.77.33.112 \
  "docker ps --format '{{.Names}}\t{{.RunningFor}}' | grep -E 'admin-|storefront-|super-admin-'"
```

`RunningFor` is the honest signal: "11 minutes ago" means you are still looking at the *previous*
deploy. Only once the id changes are HTTP checks meaningful. It tells you something *changed*; the
image sha tells you **what** is running, which is the question you actually have.

**This is not hypothetical — it fooled a check on 2026-07-20.** A watcher matched `Up N (seconds|minute)`
against `Up 10 minutes`, declared "containers rebuilt + healthy", and confirmed 200s from
`app.tokophi.com` — all of it true, all of it about the *previous* build. The deploy under test had not
started. **A false green costs exactly as much trust as a false red.** If a check can pass while the
thing it tests has not happened, it is not a check.

Corollary: `docker ps` during a build shows an extra short-lived Coolify container (a random-looking
name, `Up N seconds`). That is the build running — its presence means the deploy is *in flight*, not done.

### 🔴 …AND THE IMAGE TAG DOES NOT PROVE THE *ENVIRONMENT* ARRIVED (N60, learned 2026-08-06)

Every check above answers "is the right CODE running". None answers "did the right ENV get in", and
those are different questions with the same green light. Measured 5→6 August: `SIGNUP_ENABLED=true`
was saved in Coolify at **17:03 UTC**; deployment #368 had started at **16:59** — Coolify snapshots
the environment when a deployment BEGINS — so the generated compose read `SIGNUP_ENABLED: ''`.
Correct image tag, healthy containers, all four hosts 200/307, and `/daftar` still shut. It was found
only by hand, with `docker exec … printenv`.

**⚠️ The value must be saved BEFORE the deployment starts. Saving it during a build silently misses
that build** — and the next webhook build (someone else's merge) will pick it up, which makes the
symptom look intermittent.

Ask the process itself, from inside the container so the secret never reaches your shell history:

```bash
ssh -i ~/.ssh/tokophi_dev root@45.77.33.112 \
  'c=$(docker ps --format "{{.Names}}" | grep -m1 "^admin-"); \
   docker exec "$c" sh -lc "wget -qO- --header \"x-cron-secret: \$CRON_SECRET\" http://localhost:3000/api/health/env"'
```

`{"ok":true,"missing":[]}` is the answer you want. `ok:false` names exactly which REQUIRED variable is
empty — and the list distinguishes required from optional, because half of them are *supposed* to be
empty (`SIGNUP_ENABLED` empty = signup closed on purpose; `GOOGLE_CLIENT_ID` empty = the button is
hidden). It returns **names and presence only, never a value**: half the list is credentials.

The route is excluded from the auth middleware exactly like `api/cron/` — it is asked by a machine
with no session — and carries its own `CRON_SECRET` gate, fail-closed in production. Left inside the
matcher it answered **307 to /login**, which `curl` reads as success.

### Container health is NOT the artefact check either (learned again, 2026-07-30)

`RunningFor` catches the "old containers still serving" case. It does **not** catch these three, all of
which happened in one afternoon:

1. **A partial swap.** Coolify replaces the services one at a time. A check that waits for the *admin*
   container to change reports success while the **storefront** is still the old one — and then 503s a
   minute later when its turn comes. Wait for **every** app container (`admin`, `super-admin`,
   `storefront`) to be healthy, and require the streak to hold across two polls.
2. **Overlapping deploys.** Three PRs merged inside 25 minutes queued **four** webhook builds. Each one tears
   the stack down again, so any single "it's up now" observation is meaningless. CLAUDE.md already says
   it: **merge, watch the deploy land, then let the next one go.** This is what that costs when ignored.
3. **A healthy container running the PREVIOUS commit.** Deployment N finishes and everything is green
   while deployment N+1 — the one carrying your change — is still building.

🔴 **`application_deployment_queues` IS SHARED ACROSS COOLIFY APPS ON THIS BOX.** This server also runs
**Formalin** (app id `2`). An unfiltered `select … from application_deployment_queues order by id desc`
— which this document used to print — shows *Formalin's* builds as though they were ours. On
2026-08-01 that presented an "in-flight deploy of commit `11d86a2`" that this repository has never
contained. **Always filter, and quote it — the column is `varchar`, so `= 1` errors:**

```sql
select id, status, left(commit,8), created_at, finished_at
  from application_deployment_queues
 where application_id = '1'          -- TokoΦ. Formalin is '2'.
 order by id desc limit 3;
```

**So the only honest check is a CONTENT check: ask production for something only the new code can
produce.** Pick a signal from the diff itself and poll for it:

```bash
# e.g. after changing the TikTok feed's image shape — 1 element, not 4:
curl -s https://toko.tokophi.com/feed/tiktok.xml \
  | python3 -c "import sys,re;m=re.search(r'<item>.*?</item>',sys.stdin.read(),re.S);print(m.group(0).count('<g:additional_image_link>'))"
```

A migration count (`select count(*) from drizzle.__drizzle_migrations`), a new response header, a new
field in an API payload, a new route answering 200 — anything the old build cannot emit. Health checks
tell you the container is alive; only this tells you it is running **your** code.

## Env to set in Coolify

⚠️ **`INTEGRATION_TOKEN_KEY` IS NOT IN `.env.coolify.example`** (audited 2026-07-30 — this page said it
was), and `docker-compose.coolify.yml` forwards `${INTEGRATION_TOKEN_KEY:-}`, i.e. empty by default. It
IS set on the live stack, so production works today. But a by-the-book redeploy from the examples ships
with it unset, and the failure is silent in the only way that matters: the Seller's Pemasaran → Pelacakan
save is REFUSED (correctly — it will not store a token in plaintext) with a message naming an internal
env variable, and by that card's own copy **every prepaid conversion then records nothing at all**. Add
it to both example files.

⚠️ **`ANTHROPIC_API_KEY` — OPTIONAL, AND EMPTY IS THE HONEST DEFAULT** (Task 8.7, 2026-09-09). It is
the ONLY thing that turns on Seller → Promo → **"Generate dengan AI"**. Before 8.7 that button shelled
out to the `claude` CLI, which exists on a developer's laptop and not in the admin image, so in
production every press answered *"Claude CLI tidak ditemukan di server."* — a shipped control whose
only possible outcome was an error. It is a plain HTTPS POST to the Anthropic Messages API now
(`apps/admin/lib/promo-ai.ts`, no SDK dependency), and `docker-compose.coolify.yml` forwards
`${ANTHROPIC_API_KEY:-}` into `admin` only. Unset ⇒ the card renders the button **disabled** with the
reason on it and the server action refuses with `{ ok:false, error }` — the feature is off, not
broken, the same posture as `GOOGLE_CLIENT_ID`. Set ⇒ every press spends API quota, so it is a cost
decision, not a config chore. The key is never logged, never returned to the browser, and the
provider's own error text never reaches the merchant (ADR 0004) — only the HTTP status is
`console.error`ed.

⚠️ **`KIRIMINAJA_API_KEY` / `KIRIMINAJA_ENV` / `AUTOLARIS_API_KEY` ARE FALLBACKS SINCE TASK 8.33
(2026-09-17), NOT THE SOURCE OF TRUTH.** The keys and the live KiriminAja environment are managed on
Super Admin → Pengaturan (Kurir / Pembayaran cards, owner rank), stored encrypted in the database
(migration `0111`) and read with **DB row > env** precedence by every booking, quote, webhook check
and health probe (`@tokophi/lib/provider-config`, 60 s in-process cache). A deploy whose card was
never touched keeps working from these variables exactly as before; once a key is saved on the card
the variable is ignored for that slot. Consequences for ops: (1) rotating a key or moving to
production is a card action, **not a Coolify edit + redeploy**, and it reaches every replica within
a minute; (2) `api/health/env` reports these three as optional and adds a `providers` block naming
the SOURCE (`db` / `env` / `none`) per key — read that, not presence; (3) **`INTEGRATION_TOKEN_KEY`
is now load-bearing for shipping and payments too** — without it the stored keys cannot be decrypted
and the env fallback is all there is; (4) the "KiriminAja 401 after a restart" runbook above still
applies, but check the card's active env and masked tail before reading the container env.

See `.env.coolify.example`. Secrets: `POSTGRES_PASSWORD`, `AUTH_SECRET` (change!), `KIRIMINAJA_API_KEY` (fallback, see above), `AUTOLARIS_API_KEY` (fallback), `AUTOLARIS_CALLBACK_SECRET`, **`INTEGRATION_TOKEN_KEY`** (≥16 chars — encrypts the merchants' CAPI tokens AND the platform's provider keys; see the conversion-cron section, rotation is a code change). Cross-surface URLs (set AFTER domains assigned): `PUBLIC_APP_URL`, `ADMIN_URL`, `PUBLIC_ONGKIR_API`, `PUBLIC_ORDER_API` (⚠️ the storefront reads these at RUNTIME — must be the public admin URL, not localhost, or the kecamatan search / order / payment silently fail). Custom domains: `CUSTOM_DOMAIN_CNAME_TARGET` (default **`cname.tokophi.cc`** — the SaaS zone; it read `.com` until 2026-08-08 and that was wrong).

## ✅ `tokophi.com` is LIVE (cutover done 2026-07-13)
> The runbook below is kept as the record of HOW it was done. Current live state:
> `tokophi.com`/`www` → **landing** (`apps/landing`, static Astro) · `app.` → admin · `rich.` → super-admin · `toko.` → demo store · **`<slug>.tokophi.com` → that merchant's storefront** (one storefront container serves every store; tenant read from the `Host` header). All records **proxied**; old `.sslip.io` hosts still routed as a fallback.
>
> **Three things that will bite whoever touches this next:**
> 1. **TLS for `<slug>.tokophi.com` comes from a Cloudflare Origin CA cert** (`/data/coolify/proxy/dynamic/tokophi-origin-tls.yaml`, cert in `proxy/certs/`, valid to 2041) served as Traefik's **default certificate**. Let's Encrypt **cannot** issue a wildcard over HTTP-01. That cert is trusted **only by Cloudflare** → **never set a `tokophi.com` record to DNS-only (grey)**; browsers would hit it directly and reject it. Zone SSL mode must be **Full (strict)**.
> 2. **The wildcard Traefik router carries `priority=1` on purpose.** `HostRegexp(^[a-z0-9-]+\.tokophi\.com$)` also matches `app.`/`rich.`/`toko.`/`www.`, and Traefik's **default priority is the rule's LENGTH** — the regexp is longer than `Host(\`app.tokophi.com\`)`, so without the explicit low priority the **storefront hijacks the admin domain**. Do not remove it.
> 3. **Coolify env vars are Laravel-encrypted AND PHP-serialized** (`s:34:"…";`). Editing them by raw SQL without replicating that envelope corrupts them. `cf_env.py` (session scratchpad, in the WORKLOG entry) does it correctly and verifies by decrypting back.

## 🚀 Going live on `tokophi.com` — the runbook that was executed

> Currently everything runs on `*.45.77.33.112.sslip.io` (no real domain). `tokophi.com` is bought + its zone is on Cloudflare (2026-07-09), DNS not yet pointed. **The code is env-driven** — going live is DNS + env + redeploy, no code changes. Topology: **Cloudflare edge → Coolify/Traefik (45.77.33.112) → containers**.

**Domain plan** — `tokophi.com` is the **front door / landing page** ("pintu masuk", our own marketing page — **not built yet, TODO**); each surface gets its own subdomain:

| Surface | Hostname | Notes |
|---|---|---|
| **landing / marketing** | `tokophi.com` + `www.tokophi.com` | the platform's own front page ("isi = page kita") — **not built yet** (placeholder / redirect to `app` until then) |
| **client admin** (merchants) | `app.tokophi.com` | merchant login + editors |
| **super-admin** (us) | `rich.tokophi.com` | platform control plane (internal) |
| **storefront** (demo store) | `toko.tokophi.com` | the demo store — a RESERVED label, never a merchant slug |
| **storefront** (per merchant) | **`<slug>.tokophi.com`** | e.g. `batiknusantara.tokophi.com` — **one deploy serves every store**, resolved from the `Host` header (ADR 0009). Set `STOREFRONT_BASE_DOMAIN=tokophi.com` |

**⚠️ Why `<slug>.tokophi.com` and NOT `<slug>.toko.tokophi.com`** (decided 2026-07-13): Cloudflare **Universal SSL covers only ONE wildcard level** — `*.tokophi.com` ✅, `*.toko.tokophi.com` ❌. The two-level scheme would force either paid **Advanced Certificate Manager** (~$10/mo) or an origin Let's Encrypt **DNS-01** wildcard served **grey-cloud** (which exposes the origin IP and drops CF's protection). The one-level scheme is free, stays **proxied**, and needs **no code change**. Cost: merchant slugs share the apex namespace with our own surfaces — handled in code by `RESERVED` (`www/app/rich/admin/api/cname/toko/storefront/localhost` never resolve as a store slug, in BOTH host rules).

**Steps (in order):**

1. **Cloudflare DNS** — add `A` records for `@`(root), `www`, `app`, `rich`, `toko`, **and `*` (wildcard, for `<slug>.tokophi.com`)** → **`45.77.33.112`**. Start **DNS-only (grey cloud)** so Coolify/Traefik can issue Let's Encrypt certs via HTTP-01; flip to **proxied (orange)** after certs are live. ⚠️ **A wildcard record only gets a CF-proxied cert via Universal SSL when proxied** — LE HTTP-01 cannot issue a wildcard, so the storefront's per-store hosts rely on **Cloudflare's edge cert** (proxied) + whatever origin cert Traefik has; verify a fresh `<slug>.` host over https before calling it done.
2. **Coolify domains** — set the app's `docker_compose_domains` DB field (or per-service Domains in the UI) to the **https** hostnames: `{"admin":{"domain":"https://app.tokophi.com"},"super_admin":{"domain":"https://rich.tokophi.com"},"storefront":{"domain":"https://toko.tokophi.com"}}` (⚠️ super-admin service → underscore key `super_admin`). Redeploy → Traefik requests Let's Encrypt certs. `tokophi.com`/`www` → the (future) landing app, or a redirect to `app` for now.
2b. **Traefik wildcard router for the storefront** — Coolify's Domains field takes explicit hostnames, so `<slug>.tokophi.com` needs a **`HostRegexp`** rule (e.g. ``Host(`toko.tokophi.com`) || HostRegexp(`^[a-z0-9-]+\.tokophi\.com$`)``) added as a Traefik label on the storefront service, and the original **`Host` header must be preserved** (no host rewrite) — the app resolves the tenant from it. The explicit surface hosts (`app.`/`rich.`) keep their own routers, which match first; `RESERVED` in code is the second line of defence.
2c. **Seller subdomains on `tokophi.id`** (`namatoko.tokophi.id`, added 2026-07-16) — a **sibling wildcard router** for the `.id` apex, shipped as a Traefik **dynamic file** `ops/tokophi-stores-id.yaml` → `/data/coolify/proxy/dynamic/` (proxy watches the dir → hot reload, no container recreate). It references the stable `tokophi-stores@docker` service, so it survives app redeploys. `tokophi.id` zone: NS on Cloudflare, `*.tokophi.id`+apex `A` → `45.77.33.112` **proxied**, SSL mode **`full`** (NOT strict — the origin's default cert is `*.tokophi.com`, which does not cover `.id`; `full` skips origin-cert validation), **Always Use HTTPS on**. No app env or code change was needed — `<slug>.tokophi.id` resolves via the storefront's first-label fallback. ⚠️ Reserved first labels (`app`/`rich`/`www`/`toko`) on `.id` currently serve the demo store (STORE_SLUG fallback) since no explicit `.id` surface router exists — benign (storefront is public), give them their own router if a real `app.tokophi.id` is ever wanted. Verified end-to-end 2026-07-16: `https://batik-nusantara.tokophi.id/` → 200, valid edge cert, correct store.
2c-redirect. **`<slug>.tokophi.com` → 301/308 → `<slug>.tokophi.id`** (2026-07-16) — tokophi.id is now the **single canonical storefront domain**, so the old `.com` merchant hosts redirect (slug+path+query preserved) instead of serving a duplicate. Traefik dynamic file `ops/tokophi-com-to-id-redirect.yaml` → `/data/coolify/proxy/dynamic/`: a `redirectRegex` middleware on a `HostRegexp(^[a-z0-9-]+\.tokophi\.com$)` router at **priority 2** (beats the storefront `.com` wildcard at priority 1, loses to the explicit `app.`/`rich.`/`toko.`/`www.` routers whose rule-length priority ≫ 2 — so platform surfaces + the `toko.tokophi.com` demo are NOT redirected). Verified: `batik-nusantara.tokophi.com/produk/x?a=1` → 308 → `…tokophi.id/produk/x?a=1` → 200; `app.`/`rich.` → login (307), `toko.tokophi.com` → 200, all unaffected.
2c-platform. **`app`/`rich`/`www`.tokophi.id → 301 → `.com`** (2026-07-16) — the storefront's `.id` wildcard is `^[a-z0-9-]+\.tokophi\.id$`, and `app` matches it, so `app.tokophi.id`, `rich.tokophi.id` and `www.tokophi.id` were all serving the **demo storefront** (HTTP 200, "Beranda — Batik Nusantara"); with a platform path attached (`app.tokophi.id/store/<slug>`) Astro answered a bare **404**, which is how it was found. Dismissed as "benign" when the `.id` router shipped — wrong: the topology now has **two** domains (platform `.com`, storefronts `.id`), so mixing the TLDs is the obvious mistake, not an exotic one, and a seller who types the wrong one must land on their dashboard, not on somebody's shop. Fixed by `ops/tokophi-id-platform-redirect.yaml` → `/data/coolify/proxy/dynamic/`: a `redirectRegex` on `Host(app|rich|www.tokophi.id)` at **priority 5** (above the `.id` storefront wildcard's 1, far below the explicit `.com` routers it never touches), same label + other TLD, path/query preserved. `<slug>.tokophi.id` is deliberately unmatched. Verified: `app.tokophi.id/store/batik-nusantara` → 308 → `app.tokophi.com/store/batik-nusantara`; `batik-nusantara.tokophi.id` still 200; `app.tokophi.com` still 200.
2c-www. **`www.tokophi.com` → 301 → `tokophi.com`** (fixed 2026-10-12) — the landing service's compose label `redirectregex.replacement=https://tokophi.com/$${1}` reaches Traefik un-interpolated through Coolify, so every www URL answered `308 → /${1}` and 404'd. Fixed by `ops/tokophi-www-apex-redirect.yaml` → `/data/coolify/proxy/dynamic/` (router priority 1000, wins over the label router at 100; service `landing-svc@docker`). The compose labels are kept because Coolify's generated apex router lists the `www-to-apex` middleware by name. Verified: `www.tokophi.com/fitur/?a=1` → 301 → `tokophi.com/fitur/?a=1`; apex, `app.`, and `<slug>.tokophi.id` still 200; no proxy errors.
2d. **Custom merchant domains → Cloudflare for SaaS** (enabled 2026-07-16, feature code still pending — slice 4) — the SaaS zone is **`tokophi.cc`** (Cloudflare for SaaS ENABLED; fallback origin `cname.tokophi.cc` **active**; `cname.tokophi.cc` `A`→`45.77.33.112` proxied; SSL mode `full`). Merchants will `CNAME` their domain → `cname.tokophi.cc`; `CUSTOM_DOMAIN_CNAME_TARGET=cname.tokophi.cc` is **set in Coolify and is now also the code default** (was `.com` until 2026-08-08).

   > ⚠️ **This entry was RIGHT the whole time and was not read.** On 2026-08-07 the stale `.com` in
   > `specs/docs/CUSTOM_DOMAIN.md` was trusted instead, and a fallback origin plus a custom hostname were
   > created **in the wrong zone**, with the merchant told to CNAME to a target that can never validate.
   > This file already named `tokophi.cc`, the active fallback origin, and the router constraint below.
   > **When two docs disagree, check which one the code agrees with — not which one is better named.**

   **Progress since:** the CF side is done for `beautyinu.co` — custom hostnames `beautyinu.co` +
   `www.beautyinu.co` are registered in the `.cc` zone (both `pending` until the merchant publishes real
   CNAMEs; their apex currently holds **hand-copied A records** of `cname.tokophi.cc`'s shared IPs, which
   Cloudflare-for-SaaS always refuses). Verification now rejects exactly that (DOM-3,
   `apps/admin/lib/domain-servable.ts`) — ⚠️ **never by comparing IPs**, which would have passed it. Still TODO: the provider client in `apps/admin/lib/actions/domain.ts` (register/poll/delete custom hostname via the CF API), a Traefik router for the forwarded custom-hostname traffic — ⚠️ **measured 2026-08-07: a catch-all at `priority=1` is NOT safe.** `formalin-web`, a different live application on this same proxy, already occupies priority 1, so a catch-all ties with it on every `*.formalin.store` host; raising ours to 2 would hijack their subdomains instead. Use an **explicit `Host()` list** for verified domains — deterministic, and its long rule gives it a default priority far above 1. (Confirmed and reusable: every tokophi router sits at 38–100, and the storefront already 404s unknown hosts cleanly.), and the §3.4 SNI check (moot while `tokophi.cc` stays `full`). Pricing: first 100 custom hostnames free, then $0.10/hostname/mo.
3. **Storefront env** — `STOREFRONT_BASE_DOMAIN=tokophi.com` (enables `<slug>.tokophi.com` → store) and keep `STORE_SLUG=batiknusantara` as the fallback so `toko.tokophi.com` / bare-IP hosts still serve the demo store (slug renamed from `batik-nusantara` 2026-08-12 — an explicitly-set Coolify env overrides the compose default and must be updated too). Optional: `STOREFRONT_CACHE_TTL_MS` (default 15000).
4. **Cross-surface env** (set AFTER domains, then redeploy) — **all four point at the admin domain** (the AutoLaris pay callback `/api/public/pay/callback` + the ongkir/order public APIs all live in the admin app; the storefront is only a consumer): `PUBLIC_APP_URL=https://app.tokophi.com`, `ADMIN_URL=https://app.tokophi.com`, `PUBLIC_ONGKIR_API=https://app.tokophi.com` (storefront also rewrites `/api/uploads/*` media against this), `PUBLIC_ORDER_API=https://app.tokophi.com`.
4. **Harden secrets for prod**: rotate `AUTH_SECRET` (strong random — shared across admin+super-admin for cross-subdomain impersonation, gotcha #11), `POSTGRES_PASSWORD`, `CRON_SECRET`; set the **real** `KIRIMINAJA_API_KEY`/`AUTOLARIS_API_KEY` + `AUTOLARIS_CALLBACK_SECRET` (switch `KIRIMINAJA_ENV` sandbox→production when ready).
5. **AutoLaris callback URL**: the pay callback the gateway hits is `PUBLIC_APP_URL + /api/public/pay/callback` = `https://app.tokophi.com/api/public/pay/callback` (set via `PUBLIC_APP_URL` in step 3; verify it in the AutoLaris dashboard) so paid VAs settle.
6. **Cloudflare after proxied**: SSL/TLS mode **Full (strict)**; **Always Use HTTPS** on; cache rule = **bypass** for `app.` + `rich.` + any `/api/*` (dynamic, cookies), cache static `/_astro/*` + `/products/*` on `toko.`; keep `www → apex` redirect.
7. **Billing cron**: nothing to schedule — the `cron` sidecar in the compose is the only caller (see “Billing cron” above). If you ever call it by hand, send `x-cron-secret: $CRON_SECRET` as a **header**; `?secret=` is refused since Task 4.13.
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

## Offsite backup (Cloudflare R2) — how to switch it on

The `backup-offsite` sidecar ships INERT: with no credentials it logs `offsite-UNCONFIGURED` and
reports unhealthy (deliberate — see `SLA-DRP.md` §3). Four variables in **Coolify → the TokoΦ
resource → Environment Variables** turn it on; no code change, no redeploy of anything else.

1. **Mint the token** — Cloudflare dashboard → R2 → *Manage R2 API Tokens* → Create. Permission
   **Object Read & Write**, scoped to the one bucket. ⚠️ It must be an **account-scoped** token: the
   zone-scoped tokens already on this estate cannot see R2 at all (verified 2026-09-02 — `/accounts`
   returns empty for both).
2. **Create a PRIVATE bucket** (e.g. `tokophi-backups`). Never enable public access: these dumps hold
   customer PII — names, phones, delivery addresses — and password hashes.
3. **Set in Coolify**, then redeploy (or just restart `backup-offsite`):
   - `R2_ACCOUNT_ID` — the 32-char account id (R2 endpoint is derived: `https://<id>.r2.cloudflarestorage.com`)
   - `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` — from step 1
   - `R2_BUCKET` — from step 2
   - optional `R2_RETENTION_DAYS` (default **30**; longer than the local 14 on purpose)
4. **Verify it actually ran** — not that the container is up:
   ```bash
   docker logs $(docker ps --format '{{.Names}}' | grep -m1 '^backup-offsite') --tail 5
   # want: offsite-ok <timestamp> bucket=… retention=30d     (not offsite-UNCONFIGURED/FAILED)
   docker inspect $(docker ps --format '{{.Names}}' | grep -m1 '^backup-offsite') --format '{{.State.Health.Status}}'
   ```
   `healthy` here means a real upload+prune round finished within 8 h — the state file is written
   only after one, so a live loop with a dead credential cannot read as healthy.

### Restore FROM R2 (the half that makes it a backup)

Uploading is not a backup until this has been done at least once. Run it against a THROWAWAY
database, never production:

```bash
# 1. pull the newest dump out of R2 (inside the sidecar, where the credentials already are)
docker exec $(docker ps --format '{{.Names}}' | grep -m1 '^backup-offsite') \
  sh -c 'rclone copy "r2:$R2_BUCKET/postgres" /tmp/restore --include "*.dump" --max-age 24h && ls -l /tmp/restore'
# 2. restore it into a scratch database and count rows — a dump that will not restore is not a backup
docker exec -i $(docker ps --format '{{.Names}}' | grep -m1 '^postgres-') \
  sh -c 'createdb -U tokophi restore_probe && pg_restore -U tokophi -d restore_probe --no-owner' < <dump>
docker exec -i $(docker ps --format '{{.Names}}' | grep -m1 '^postgres-') \
  psql -U tokophi -d restore_probe -c 'select count(*) from orders;'
# 3. ALWAYS drop the scratch database afterwards
docker exec -i $(docker ps --format '{{.Names}}' | grep -m1 '^postgres-') dropdb -U tokophi restore_probe
```
