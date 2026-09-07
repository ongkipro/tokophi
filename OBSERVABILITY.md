# Observability Contract — tokophi

Updated: 2026-09-08
Status: REQUIRED

Probe format:

```text
Probe: <name>|<url>|<expected-status>|<contains-or-TBD>|<max-latency-ms>
```

The expected status may be an exact code (`200`) or an inclusive range
(`200-299`). Every configured probe is mandatory. Use stable, non-secret public
endpoints only; private-network probes require an explicit local-test override.

> `app.` and `rich.` answer **307** (middleware → `/login`) and that is healthy; a probe demanding
> 200 there is red forever and gets ignored (`specs/docs/DEPLOY.md`). Redirects are not followed —
> the 307 *is* the evidence. `ongkir-search` is the only probe that proves Postgres is alive
> (`resolveArea()` → ILIKE over `kiriminaja_areas`); `ongkir-rates` proves the courier API accepts
> us and is the probe that was **red on 2026-09-07** (IP allow-list) while everything else was green.

Probe: landing|https://tokophi.com/|200|TBD|2000
Probe: admin|https://app.tokophi.com/|307|TBD|2000
Probe: super-admin|https://rich.tokophi.com/|307|TBD|2000
Probe: storefront-demo|https://toko.tokophi.com/|200|TBD|2000

Two checks that decide whether the shop can SELL are POSTs and do not fit the one-line format; they
are run by `ops/tokophi-probe.sh` (search) and by hand / Super Admin → Pengaturan → "Tes koneksi
KiriminAja" (rates) and count as configured probes all the same:

- `ongkir-search` — `POST https://app.tokophi.com/api/public/ongkir` body `{"op":"search","q":"Semarang"}` → 200 containing `Semarang` (proves Postgres).
- `ongkir-rates` — `POST …/api/public/ongkir` body `{"op":"rates",…}` for a seeded route → 200 with a non-empty `rates` list, never `SHIPPING_QUOTE_UNAVAILABLE` (proves the courier API accepts our IP). **Red as of 2026-09-07.**

## What actually exists (all of it verified by reading the file named)

| Layer | Thing | Where it runs | What it catches |
|---|---|---|---|
| L1 | `ops/tokophi-watchdog.sh` — `docker start` for app containers left in `created`/`exited`; heartbeat to `/var/log/tokophi-watchdog.log` | **on the VPS**, cron every minute | 2026-07-14 shape: Coolify built but never started the containers |
| L1b | `ops/tokophi-docker-cleanup.sh` — disk broom | on the VPS, hourly | 2026-07-18 shape: disk 100 % → Postgres crash-loop |
| L2 | **`ops/tokophi-probe.sh`** — the four checks: 5 public hosts, `POST /api/public/ongkir {op:"search"}`, disk % + free GB over ssh, L1 heartbeat freshness; pages a human after 3 consecutive failures | **must run OFF the box** (laptop / second VPS / CI), `*/5` cron | a container that is `running` and unhealthy — L1 structurally cannot see it |
| T-11 | `ops/check-deploy-currency.sh` — Coolify's own `application_deployment_queues` vs the running image tag | on the VPS | a wedged serial deploy queue: all hosts green on OLD code (2026-08-06) |
| env | `GET /api/health/env` (`apps/admin/app/api/health/env/route.ts`) — names + presence of every required env var, **never a value**; gated on the `x-cron-secret` header (`lib/cron-auth.ts`), fails closed | one request after every deploy | a value saved in Coolify that never reached the container |
| cron | `cron_runs` (migration `0091`) — one upserted row per sidecar with its self-reported `interval_sec`; rendered at Super Admin → Analitik → Sistem (`app/(platform)/analitik/cron-liveness.ts`) in red once overdue | in-app | `cron-tracking` silent for a week while `awbFilled` sat at 0 |
| suite | `npm run verify -w @tokophi/storefront` — builds, starts ONE storefront, runs all six `check-*.mjs` (pixel defer, srcsets, image widths, h1 floor…) | dev / CI | perf and markup regressions build/lint/`astro check` cannot see |
| data | `npm run verify-rls -w @tokophi/db` (12 checks, `54/55` tables today) · `npm run verify-ledger -w @tokophi/db` | dev, and ledger also against production (2026-08-05) | tenant leaks; orphan rows in the balance |
| backup | `backup` sidecar healthcheck: unhealthy if no `*.dump` younger than 8 h; `backup-offsite`: unhealthy unless a real upload round succeeded within 8 h | on the VPS | a backup loop that is alive but writing nothing |

⚠️ **`verify-ledger` is NOT read-only** (AGENTS.md): `refusesDanglingInsert` opens a write
transaction that inserts a probe store + dangling row to prove the FK trigger fires *today*, then
always throws so it rolls back. Safe against production, confirmed by `select count(*) from stores
where slug like 'fk-probe-%'` → 0 — but any "what touches production" audit must count it.

## The gap, measured 2026-09-07

**Nothing external watches the box.** Production was suspended by the hosting provider for ~70 h
(2026-09-04 20:27 → 2026-09-07 18:47 WIB) and the first signal was a user report about a form. Every
layer above except L2 runs *on* the VPS, so it went down with it; L2 (`tokophi-probe.sh`) exists,
is designed for exactly this, and **nothing shows it installed off-box** — no cron on this workstation
(`crontab -l`, 2026-09-08), no BUILD-LOG entry installing it anywhere, and a 70-hour silence that a
5-minute probe with a pager could not have produced. `backup-offsite` is
shipped but was still `offsite-UNCONFIGURED` at the last log entry (2026-09-03), so the only copies of
the database sat on the suspended machine. Closing this = install `ops/tokophi-probe.sh` on a
machine that is not `volumdev`, with a pager behind it, and hand it the R2 credentials. Neither is
code; both are owner actions.

## Recommended production probes

Add probes for database connectivity, background jobs, queue/worker health, or a
critical-error sentinel when the application exposes stable HTTP endpoints for
them. Keep vendor-specific credentials and query tokens out of this file.
`api/health/env` is deliberately **not** listed as a probe above: it needs the cron secret, and this
file must stay secret-free. The cron liveness table is read on a screen, not over a public URL.
