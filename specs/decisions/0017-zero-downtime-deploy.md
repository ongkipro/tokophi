# ADR 0017 — Deploy window: health-first in-place swap on Coolify compose, ~7–8 s accepted as the floor

**Status:** accepted · **Date:** 2026-08-28 (the day the last measurement landed) · **Decided by:** the owner
("lanjut healthcheck + rolling coolify biar zero-downtime", 2026-08-28) for the structural changes;
the three routes to an absolute-zero window are **recorded as options and NOT decided** (§5)  
**Supersedes:** none · **Related:** ADR 0009 (one storefront container, tenant from `Host`) ·
`specs/docs/DEPLOY.md` · `specs/docs/SLA-DRP.md` §4 · root `TASKS.md` Task 8.11 (NF-8)

> **Numbered 0017, not 0016.** `DECISIONS.md` says the next free number is 0016, but 0016 is already
> spoken for: `specs/README.md`, `specs/docs/REQUIREMENTS.md` (F-K11) and
> `specs/docs/DEVELOPMENT_READINESS.md` all link `0016-global-buyer-account.md` — the Account/headless
> decision of Task 5.8, which has not been written yet. Taking 0016 here would turn three dangling
> links into links to the wrong decision. 0010 is deliberately unused (see ADR 0012's intake note);
> 0016 stays reserved for Task 5.8.

---

## 1. Context — two different 503 windows, two different causes

Every merge to `main` rebuilds and redeploys the whole stack on one VPS through Coolify's Docker
Compose build pack (`docker-compose.coolify.yml`). Until 2026-08-19 nobody had measured what a
deploy cost the merchant; the SSR note in `DEPLOY.md` ("the container starts in seconds") was easy
to read as "deploys are seamless". Measured, they were not. Every figure below is from
`BUILD-LOG.md` (entries dated 2026-08-19 and 2026-08-28) and was taken by an HTTP probe from the
second of merge until recovery — not from log-reading and not from a single snapshot.

### 1.1 First cause (2026-08-19): the `migrate` gate held the apps behind the seed chain

| deploy | 503 window | what the `migrate` service ran |
|---|---|---|
| `#279` | **~15 min** (all three app surfaces; `landing` stayed 200) | `drizzle-kit migrate` **+ 8 seed scripts**, and `admin`/`super-admin`/`storefront` all waited on it with `service_completed_successfully` |
| `#281` | **81 s** — 503 began at +506 s, recovered at +587 s | migrations only; a new `seed` service carries the chain, depends on `migrate`, and **nothing depends on it** |
| `#283` (2026-08-20) | **none observed** — 15 min of probing at 15 s resolution | idem |

Probe: `app.tokophi.com/login` every 20 s (every 15 s for `#283`). Corroborated on the box during
`#281`: `migrate` was `Exited (0)` 28 s earlier while `seed` had been up 27 s — the demo-data chain
was genuinely behind the serving path.

⚠️ **This history contains a claim that was false, and it was corrected the same day.** The first
version of the 2026-08-19 note split the 15 minutes into "build ~6 min **with the old containers
already torn down**" + "migrate ~7 min". Measured on `#281`, all three hosts answered **200 for the
whole build**; the 503 began at second 506, at the swap. **Build contributes no downtime at all.**
The error came from one mid-deploy snapshot (no app containers + a just-finished build) turned into
cause-and-effect without testing it. The corrected finding — the seed chain holding
`service_completed_successfully` was nearly all of the window — is what the split in `#281` fixed.

The `#283` "none observed" row must be read as "no 503 at 15-second resolution", not zero: whether
the new container passed its healthcheck before the old one was released was not something the
arrangement guaranteed.

### 1.2 Second cause (2026-08-28): Coolify tore down the ENTIRE stack on every deploy

With a 300 ms probe against all three hosts (`app.` / `rich.` / `toko.`), deploy **521** — the
baseline for this wave — measured **81–115 s**, not the "boot + ≤15 s healthcheck" that the
configuration arithmetic predicted. Forensics from the container timeline and Coolify's command
log: the healthchecks were already working (`migrate` 04:45:44 → :49 = 5 s; apps started :49, healthy
by ±:53). What dominated was Coolify `docker stop`-ping **every** old container one by one
(04:44:00) and creating a new stack (04:45:38) — including `postgres`, whose configuration had not
changed. Container names carried a random per-deploy suffix, so `docker compose up -d` could never
say "unchanged".

Two further mechanics were established in the same wave, each by measurement:

- **`depends_on: migrate: service_completed_successfully`** on the routed apps forces serial order:
  compose stops a dependent **before** recreating its dependency, so the gate made every deploy
  run [old apps die] → migrate → [new apps boot] — **~13–20 s dark on every deploy**, even one that
  carries no migration (deploys 522/523).
- **A Traefik `retry` middleware cannot bridge the swap.** When the health-gated pool is empty,
  Traefik answers **503 immediately without dialling**, and the retry middleware only retries a
  failed dial. Deploy 523, with `retry-global` installed, measured `app` 19,6 s · `rich` 17,5 s ·
  `toko` 3,4 + 19,6 s — no better than 522. The expectation written in entry ③ ("retry bridges the
  rest") was wrong and entry ④ corrected it with those numbers.

### 1.3 What is and is not ours to change

| lever | owner | note |
|---|---|---|
| healthcheck shape (`start_period`, `start_interval`, `interval`) | **repo** (`docker-compose.coolify.yml`) | Docker ≥25 honours `start_interval`; VPS runs Docker 29.6.1 / Compose 5.3.1 |
| `depends_on` graph (`migrate` gate, `seed` off the critical path) | **repo** | |
| Traefik labels on the wildcard store router `tokophi-stores` | **repo** | the only router whose labels the repo owns; `app.`/`rich.`/`toko.` routers are generated by Coolify |
| `is_consistent_container_name_enabled` | **Coolify** application setting, flipped by hand in Coolify's DB | not in the repo; must be re-applied on a re-provisioned Coolify |
| entrypoint middleware `retry-global@file` | **Coolify proxy** (`/data/coolify/proxy/dynamic/tokophi-retry-global.yaml` + static arg `--entrypoints.https.http.middlewares=retry-global@file`) | not in the repo; backup of the pre-edit proxy compose in `proxy/backups/` |
| rolling / overlapping update of a compose service | **not available** — Coolify does not support rolling updates for compose-based applications; it recreates in place | platform limit |
| Next image reproducibility | **not available** — the image changes on every build even when the code did not, so all three routed apps swap on every deploy | measured on 522: a storefront-only marker change still swapped `app.` and `rich.` |

---

## 2. Decision

Keep the Coolify compose deployment and make the in-place recreate **health-first and minimal**,
in this order (each step was deployed on its own and measured before the next):

1. **Healthchecks turn healthy fast** — `start_interval: 2s` under `start_period` on
   `admin`, `super-admin`, `storefront`, `landing` (deploy 522, commit `5b7d7c8`). Traefik 3 routes
   only to HEALTHY containers, so time-to-healthy IS the swap window; a fresh container is healthy in
   ~2–4 s instead of waiting out the first 15 s tick. The cron sidecars are deliberately untouched —
   nothing routes to them.
2. **Consistent container names** — `application_settings.is_consistent_container_name_enabled =
   true` in Coolify (2026-08-28). `docker compose up -d` now recreates **only services whose
   configuration changed**: `postgres` and the cron loops survive a deploy, and the old app keeps
   serving while `migrate` runs.
3. **One retry layer, at the https entrypoint** — `retry-global` (6 attempts, exponential from
   700 ms ≈ 22 s of cover) so it also reaches the Coolify-generated routers; the router-level
   `tokophi-retry` (5 attempts from 500 ms) added in step 1 was **removed** in the same commit
   (`73c3b51`) because two layers nest — 6 × 5 dials ≈ 40 s hold on a dead backend. Retrying a
   failed dial sends no bytes, so a POST cannot be double-submitted. Kept for the dial-failure
   class it genuinely covers; **it is not the swap fix** (§1.2).
4. **Drop the `migrate` gate from the routed apps** — `admin`, `super-admin`, `storefront` depend
   on `postgres: service_healthy` only (deploy 524, commit `16b72b0`); `seed` still depends on
   `migrate`, and nothing depends on `seed`. Apps now recreate in parallel with `migrate`.
5. **Accept ~7–8 s per routed surface as the practical floor of an in-place compose recreate**,
   composed of stop old app + create + Next boot + heal (`start_interval` 2 s) + Traefik provider
   refresh. Reaching zero is a structural change with its own trade (§5) and is **not** further
   tuning; it is left for an explicit owner order.

### Why this and not the alternatives

- *Keep the `migrate` gate and "make retry cover it"* — measured not to work (523). The gate is the
  single largest lever left after consistent naming, and it guaranteed a blackout on every deploy
  to protect against a race that most deploys cannot even have (no migration shipped).
- *Split the surfaces into Coolify Dockerfile-type apps (true rolling update)* — would remove the
  window but changes the deploy unit from one compose stack to four applications, with the
  cross-service env, the shared `tokophi-uploads` volume, and the `migrate`/`seed` one-offs
  re-homed. Not taken without an owner ruling (§5).
- *Blue-green with two replicas by hand* — same reasoning; doubles the app footprint on one box.
- *Drop Traefik health-gating on the routed apps* — the cheapest route to ~0 s, but it stops
  ejecting a container that is listening-but-hung; recorded, not taken (§5).

---

## 3. Consequences

**Positive**
- Deploy window per routed surface: **81–115 s → 7,0–8,3 s (−93 %)**, with `postgres` and the cron
  sidecars no longer restarted by a code deploy at all.
- The window is now a **documented number with a source** (NF-8), so Task 8.1's alert threshold
  can be set above it instead of guessed, and `SLA-DRP.md` §4's SLO clause "excluding announced
  deploy windows" has a size to exclude.
- The first-cause fix (2026-08-19) still stands: the demo-data chain is behind the serving path.

**Negative — the trade taken, stated plainly**
- **A deploy that carries a migration can run new code against the pre-migration schema for about
  the migrate duration (~10 s).** The effect is a bounded, visible 500 on the affected query — no
  corruption — and it is strictly better than the full blackout the gate used to guarantee on every
  deploy. Migrations are idempotent and absent from most deploys. First-ever bootstrap still
  converges: the app serves 500s while unhealthy (out of Traefik's pool) until `migrate` lands,
  then heals on the next health tick.
- Two of the levers live **outside the repo** (the Coolify setting and the proxy file) and must be
  re-applied on a re-provisioned box; `DEPLOY.md` is where that belongs.
- The residual ~7–8 s is real: a shopper who lands inside it on `<slug>.tokophi.com` gets a 503
  unless a still-healthy container happens to remain in the pool. The storefront also showed a
  short blip (< 2 s; 13 × 500) while its neighbour swapped on 524.

**Neutral / operational facts that stay true**
- **The L1 watchdog is not part of this.** `ops/tokophi-watchdog.sh` restarts containers found
  `created`/`exited` and matches them by the stable `<svc>-l7r4qaqcml4zigw1dc7iptun-` prefix; a
  deploy swap is neither of those states. It never touches `migrate`. Whether consistent naming
  changed the container-name suffix it matches on is a thing to check on the box, not assumed.
- **Recreating `coolify-proxy` by hand disconnects it from the resource network** — measured as a
  4-minute outage of all three hosts (05:00–05:04 UTC, 2026-08-28) until
  `docker network connect l7r4qaqcml4zigw1dc7iptun coolify-proxy`. Restart the proxy through the
  Coolify UI, which reattaches it, or reconnect the network by hand; the pre-edit proxy compose is
  backed up in `proxy/backups/`.
- The build (~8m30s ± 30s, per `DEPLOY.md`) still contributes **no** downtime; the old containers
  serve until the swap.
- Probing was stopped after deploy 524; nothing watches the window continuously.

---

## 4. Verification evidence

| date | deploy | measurement | source |
|---|---|---|---|
| 2026-08-19 | `#279` | ~15 min of 503 on `app.`/`rich.`/`toko.`; `landing` 200 | BUILD-LOG "2026-08-19 (ketiga)" |
| 2026-08-19 | `#281` | **81 s** (+506 s → +587 s); 200 throughout the build — the "build tears down first" claim refuted | BUILD-LOG "2026-08-19 (kelima)"; `DEPLOY.md` "Jendela 503 saat deploy" |
| 2026-08-20 | `#283` | none observed at 15 s resolution | BUILD-LOG "2026-08-20 — Deploy window, third sample" |
| 2026-08-28 | 521 (baseline, 300 ms probe) | **81–115 s**; forensics: full-stack teardown at 04:44:00, new stack 04:45:38 | BUILD-LOG ZERO-DOWNTIME ② |
| 2026-08-28 | 522 (`start_interval` + consistent names) | `app` 13,9 s · `rich` 12,9 s · `toko` 7,8 + 12,9 s; postgres/cron survived | BUILD-LOG ZERO-DOWNTIME ③ |
| 2026-08-28 | 523 (+ `retry-global` at the entrypoint) | `app` 19,6 s · `rich` 17,5 s · `toko` 3,4 + 19,6 s — retry does **not** bridge an empty pool | BUILD-LOG ZERO-DOWNTIME ④ |
| 2026-08-28 | 524 (`migrate` gate dropped) | **`app` 8,3 s · `rich` 7,0 s · `toko` 7,3 s** (+ blip < 2 s) | BUILD-LOG ZERO-DOWNTIME ⑤/FINAL |

Code: commits `5b7d7c8`, `73c3b51`, `16b72b0` (2026-08-28; PRs #370–#373). What the compose
declares today, read from `docker-compose.coolify.yml` on 2026-09-09: `postgres` healthcheck
`pg_isready` every 5 s; `migrate` = `drizzle-kit migrate` only, `restart: "no"`, depends on
`postgres: service_healthy`; `seed` depends on `postgres` + `migrate: service_completed_successfully`;
`admin` / `super-admin` / `storefront` depend on `postgres: service_healthy` **only**, each with
`interval: 15s`, `retries: 10`, `start_period` 40 s / 40 s / 30 s and `start_interval: 2s`; `landing`
has no database and no `depends_on`; the four cron sidecars depend on `admin: service_healthy`; the
`tokophi-stores` router carries `middlewares=gzip` only, with the comment recording that the swap
retry moved to the entrypoint.

---

## 5. Residual and the options NOT decided

The remaining ~7–8 s is the cost of an in-place recreate and cannot be tuned away. Three structural
routes to an effectively zero window were written down on 2026-08-28; the owner has not chosen one
(BUILD-LOG 2026-08-28: "Menunggu keputusan owner … opsi struktural zero-downtime"; `TASKS.md`
Task 8.11 is marked *BLOCKED — owner decision*). They are recorded here so nobody re-derives them:

| # | option | what it buys | what it costs |
|---|---|---|---|
| ① | remove Traefik health-gating on the routed apps (container enters the pool at start; the ~1–3 s of failed dials during boot is bridged by the `retry-global` already installed) | effectively ~0 s, smallest change | a hung-but-listening app is no longer ejected from the pool |
| ② | split the surfaces into Coolify **Dockerfile-type** applications | true rolling update, supported by Coolify | four deploy units instead of one stack; env, shared volume and the `migrate`/`seed` one-offs re-homed |
| ③ | blue-green with two replicas, by hand | overlap without leaving compose | double app footprint on one 4-vCPU box; manual cut-over |

**Until one is ordered, the deploy window of record is 7–8 s per routed surface per deploy, and
any alert threshold (Task 8.1) must sit above it.** Whoever takes an option: measure with the 300 ms
three-host probe before and after, and put the numbers in `BUILD-LOG.md` — that is what made every
line above trustworthy, and it is what caught the two wrong claims in this history.
