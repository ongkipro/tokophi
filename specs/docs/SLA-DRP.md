# Availability & Disaster Recovery

**What this document owns:** the SLI/SLO/SLA distinction, the recovery objectives (RTO/RPO), the single
points of failure, the recovery runbook, and the exercise plan.

**What it does NOT own.** The deploy mechanics, the watchdogs and the incident history live in
`DEPLOY.md`; this says what they add up to as a *promise*. Security posture is `SECURITY.md`.

Claims are labelled **Observed** (measured), **Derived** (computed from measurements), **Proposal**
(not yet agreed), or **Gap**. Measured **2026-08-05** against production. §8 says how to re-derive.
**Amended 2026-09-07** with the billing-suspension incident (§2, §4, §6, §8).

---

## 1. The three words, because they get used interchangeably and are not the same

| | what it is | who sees it |
|---|---|---|
| **SLI** | the thing measured — "fraction of requests to `<slug>.tokophi.com` that return < 500" | us |
| **SLO** | our internal target for that SLI — deliberately stricter than any promise | us |
| **SLA** | the promise to a merchant, with a consequence if missed | them |

🔴 **There is no SLA today, and there must not be one until §6 is fixed.** Publishing an availability
promise the architecture cannot keep is worse than publishing none. Everything below is SLI/SLO
groundwork.

---

## 2. What is actually observed

**Observed.** Four surfaces, one VPS (`45.77.33.112`, `vhp-4c-8gb-amd`, Singapore), one Postgres
container, one region. Cloudflare in front.

**Observed — the safety nets that exist** (`DEPLOY.md` has the detail):
- **L1 watchdog** restarts containers stuck `created`/`exited`. Heartbeat measured **45 s** fresh
  against a 10-minute staleness threshold.
- **L1b disk cleanup**, daily 03:30 UTC, prunes build cache and unused images older than 48 h, and goes
  aggressive at ≥80 %. Disk measured **57 %**. It is working.
- **Compose healthchecks** with `depends_on: service_healthy`; migrations run as a one-shot the apps
  wait on.

**Observed — two recorded incidents, both self-inflicted, neither a hardware failure:**
- `2026-07-14` — Coolify built the containers, left them `created`, and moved on. Production 503'd.
- `2026-07-18` — storefront 503'd for **~2 h** while the other three stayed up. Root cause: **disk at
  100 %** (Coolify keeps every per-deploy image; 204 images / ~129 GB). L1b exists because of this.

**Observed — a third incident, 2026-09-04 → 2026-09-07, and this one was neither hardware nor code:**
- **The hosting account's balance ran out and Vultr SUSPENDED the instance** (`volumdev`,
  `45.77.33.112` — the only box) from **Fri 2026-09-04 20:27 WIB to Mon 2026-09-07 18:47 WIB**:
  **~70 h 20 min**, every surface, every host, Cloudflare **522** throughout (the landing has no DB
  and would have survived any *software* failure; it did not survive this).
- **Detection: none.** No off-box monitor exists (`ops/tokophi-probe.sh` is built and installed
  nowhere — `DEPLOY.md` §L2), there is no Vultr low-balance alert, and the box cannot report its own
  power-off. It was found **three days later** from a merchant-style "the shop is down" report.
- **Impact:** no shopper could reach any store for 70 h; the Seller and Super Admin panels were down;
  every cron sidecar (billing, tracking, conversions, backups, offsite mirror) stopped by
  construction. **Data: intact** — the volume survived, the last on-box dump before the stop was
  2026-09-04 11:50 UTC, and the shared DB shows zero orders since 2026-08-26, so nothing was lost
  *this time*. **Recovery: a top-up; the instance auto-resumed** and all 18 containers came back
  healthy without intervention (`DEPLOY.md` → "Origin unreachable / every host 522"). ⚠️ A side
  effect is STILL OPEN as of 2026-09-07: the KiriminAja sandbox now refuses the VPS IP (401
  allow-list), so **no order can be quoted or placed** until the owner fixes the vendor allow-list —
  a second, *silent* outage of the product's one money path, behind a site that looks up.
- **The RTO for this scenario was decided by a human noticing, not by any system** — which is the
  §5 gap in one sentence.

**Derived — deploy is a planned outage, and the documented number was wrong.** Measured **10 times on
2026-08-05**: merge → all four hosts green in **524, 656, 558, 542, 553, 550, 538, 531, 510 s**
(~9–11 min), with a **1,5–2,5 min window of 503** while containers swap. `OPEN.md` claimed
"~6 minutes / 60–90 s" and has been corrected. **A deploy takes the product down for ~2 minutes.**

---

## 3. RPO — and the trap that made the documented number fiction (fixed 2026-08-05)

**Observed — current shape** (`docker-compose.coolify.yml`, since #171): a `backup` service dumps
`pg_dump -Fc` → `/backups` **only if the newest dump is older than 6 h**, waking hourly; writes to
`.part` and renames on success; prunes by **age** (`-mtime +14`); and its healthcheck goes UNHEALTHY
after **8 h** without a fresh dump.

The dumps are real and readable — `pg_restore --list` on the newest returns **625 TOC entries / 621
objects**, 1,2 MB. That was never the problem. The retention was, and the box below is why.

> ### ✅ FIXED by #171 — but read this, because the number it replaces is how the bug hid.
> **Observed 2026-08-05.** All seven dumps on the box are from **the same day** —
> `10:44:05` through `16:28:01`. The backup container's `StartedAt` is `16:28:01`, **exactly** the
> newest dump's timestamp.
>
> That is the mechanism, proved rather than guessed: **every deploy restarts the container**, the loop
> dumps *immediately* on start and only *then* sleeps 86400. Ten deploys today produced ten dumps, and
> `keep-7` evicted everything older — including every recovery point from previous days.
>
> **Derived, and this is the risk that matters:** if a data-corrupting change ships and is not noticed
> within ~7 deploys, **there is no clean dump left to restore from.** The cadence is not "daily"; it is
> "on deploy, plus daily if nobody deploys". On a quiet day RPO ≈ 24 h. On a working day the *interval*
> shrinks to minutes while the *window* collapses to hours.

**Observed — the fix, verified on the container after deploy `4705fdf`:** dump only if the newest is
older than 6 h (waking hourly), retention by **age** (`-mtime +14`), atomic `.part` → rename, and a
healthcheck that goes UNHEALTHY after 8 h without a dump instead of passing on any dump ever written.

Proof it works, measured immediately after the deploy that restarted the container: `StartedAt`
**17:07:46** while the newest dump is **16:56:59** — the new container did **not** dump on start.
Seven dumps, not eight; zero stale `.part`; health `healthy`.

⚠️ **The fix does not create history retroactively.** The seven dumps on the box are still the ones the
old code left, spanning `11:08` → `16:56` on 2026-08-05 — the two oldest were evicted by deploys that
ran before the fix landed. The window **grows to 14 days over the next fortnight**; it is not 14 days
today. Do not read §4's "logical corruption" row as covered until it has.

🟡 **Gap — the backups are on the machine they protect: the MECHANISM now exists, the CREDENTIAL does
not.** `tokophi-backups` is a Docker volume on `45.77.33.112`, beside `tokophi-pgdata`; a lost VPS
still loses the database *and* every backup of it **until the R2 variables are set**.
Shipped 2026-09-02: the `backup-offsite` sidecar (`docker-compose.coolify.yml`) mirrors the existing
dumps to Cloudflare R2 hourly and prunes only the REMOTE copies (`R2_RETENTION_DAYS`, default 30).
It mounts `tokophi-backups` **read-only** — it can never delete a local dump — and uses `rclone copy`,
never `sync`, so a local prune cannot propagate. Proven against a live S3 endpoint before shipping:
upload, remote-only retention (a 60-day dump deleted remotely while both local files survived), plus
both failure paths.
🔴 **It is INERT and UNHEALTHY until the owner supplies four Coolify variables** — `R2_ACCOUNT_ID`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. Unconfigured it logs
`offsite-UNCONFIGURED` and reports unhealthy on purpose: a backup you believe in and do not have is
worse than an obviously absent one. Neither Cloudflare token on this estate can create it — both are
ZONE-scoped (verified 2026-09-02: `/accounts` returns empty for each), and R2 is an account-level
product, so the token must be minted with **R2 Storage: Edit**.
⚠️ **Still untested end to end: the RESTORE.** Uploading is not a backup until a dump has been pulled
from R2 and restored into a throwaway database. That exercise is §7's, and it has not been run.

**Proposal — RPO objectives, once the two gaps above are closed:** 24 h for a full-box loss (offsite
daily), 1 h for a logical/corruption event (retained hourly for 48 h, daily for 14 d).

---

## 4. RTO — what recovery would actually cost

| scenario | how it recovers | RTO |
|---|---|---|
| container stuck / crashed | L1 watchdog restarts it | **Observed** < 10 min (heartbeat interval) |
| disk full | L1b prune, then redeploy | **Observed** the 2026-07-18 case ran **~2 h** *before* L1b existed |
| bad release | `git revert` + push + rebuild | **Derived** ~9–11 min, from the 10 deploys measured |
| logical corruption / bad migration | `pg_restore` the newest dump | **Derived** minutes — the dump is 1,2 MB / 621 objects. ⚠️ **Untested.** |
| **hosting billing lapse (instance suspended)** | top up → instance auto-resumes → containers self-start | **Observed 2026-09-07:** minutes after payment — but the *outage* was **70 h 20 min** because nothing detected it (§2). RTO here = time-to-notice, not time-to-fix |
| **total VPS loss** | provision + Coolify install + deploy + restore | **Gap — unknown and untested.** Coolify install alone is ~10 min; realistically 1–3 h, and **there is no offsite dump to restore from** (§3) | ⚠️ `backup-offsite` exists since 2026-09-02 but is **INERT** until the R2 credentials are set (below, §6) |

**Proposal — SLO, not a promise:** 99,5 % monthly on the storefront SLI, *excluding* announced deploy
windows. That is ~3,6 h/month of unplanned unavailability. It is deliberately modest: a single box, a
single region, and one untested recovery path do not support a higher number honestly.

---

## 5. The SLI, so the number above means something

**Proposal.** Storefront availability = share of requests to `<slug>.tokophi.com` returning < 500,
measured at the **Cloudflare edge** rather than at the origin — the edge is what the shopper reached.
Seller and Super Admin get their own SLIs; they are not the same product to the same person.

**Gap.** Nothing records this today. The health loop used all day is a **human running curl**, and
`DEPLOY.md`'s watchdog checks liveness, not a served-request ratio. Until an SLI is recorded
continuously, any SLO here is an intention, not a measurement.

---

## 6. Single points of failure

| | consequence | mitigated? |
|---|---|---|
| one VPS | everything down | ❌ |
| **hosting BILLING on that VPS** (Vultr suspends on a negative balance) | everything down, **silently**, until a human notices — **realised 2026-09-04 → 09-07, 70 h 20 min** | ❌ no low-balance alert, no auto-top-up (owner action in the Vultr console: Billing → alerts / auto-payment) |
| **no external uptime monitor** | an origin outage of any cause is detected by a merchant, days later | ❌ `ops/tokophi-probe.sh` is built (`DEPLOY.md` §L2) and **installed nowhere**; needs one off-box cron + an alert channel |
| offsite backup credential | the `backup-offsite` sidecar (2026-09-02, #377/#378) mirrors dumps to R2 **only once `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` are set in Coolify** — until then it logs `offsite-UNCONFIGURED` and reports UNHEALTHY by design (`docker-compose.coolify.yml` → `backup-offsite`, BUILD-LOG 2026-09-02 "inert until credentialed") | ❌ **still uncredentialed as of 2026-09-07** (deploy 528 verified it running `offsite-UNCONFIGURED`; BUILD-LOG lists "kredensial R2" under "Menunggu keputusan owner"). Every backup is still on the same box that just spent 70 h powered off |
| one Postgres container, one volume | total data loss if the volume dies | ❌ backups are on the same box (§3) |
| one region (SGP) | regional outage = full outage | ❌ accepted for now |
| `AUTH_SECRET` | lost ⇒ every session invalid (recoverable: users log in again) | 🟡 fail-closed by design |
| Cloudflare zone | wildcard TLS is a CF **Origin CA** cert browsers do not trust directly — an unproxied record serves an untrusted cert | 🟡 standing rule: every record stays proxied |
| provider APIs (KiriminAja / AutoLaris) | a parcel we cannot price is a parcel we cannot ship — orders fail **by design** | 🟡 deliberate, documented |
| HSTS `max-age` 1 year | cannot be withdrawn early; any name under the zone must serve HTTPS for a year | 🟡 correct here, irreversible |

---

## 7. Recovery runbook

**Before touching anything: is it the disk?** `DEPLOY.md`'s first rule, learned from 2026-07-18:
```bash
ssh -i ~/.ssh/tokophi_dev root@45.77.33.112 'df -h /'
docker logs $(docker ps --format '{{.Names}}' | grep -m1 '^postgres-') --tail 20
```
Full disk + "in recovery mode" ⇒ **prune, do NOT redeploy** — a redeploy has to build, which needs the
disk it does not have.

**Bad release:** `git revert <sha>` → push → watch all four hosts. ⚠️ Expect ~9–11 min and a ~2 min 503;
that is normal, not a second failure.

**Logical corruption:**
```bash
# 1. STOP deploying. Every deploy triggers a dump and evicts an older one (§3).
# 2. Copy the dumps OFF the box before anything else.
docker cp <backup-container>:/backups ./rescue-dumps
# 3. Restore into a SCRATCH database first and reconcile before touching the live one.
```
🔴 Step 1 is the one that gets skipped, and it is the one that destroys the evidence.

**Verify after any recovery:** `verify-ledger` against production — it is the check that once found
Rp810.000 of withdrawable money with no order behind it. Run it where the credential already lives:
`docker exec -w /app/packages/db <admin-container> /app/node_modules/.bin/tsx src/verify-ledger.ts`.

---

## 8. Exercise plan — what has never been tested

An untested recovery path is a **Proposal**, not a capability. None of these has a recorded run:

- [ ] **Restore a dump into a scratch database and reconcile it** against production row counts. This
      is the cheapest and highest-value one; the dump is 1,2 MB.
- [ ] **Kill a container and time L1.** The heartbeat is fresh; the *restart* has never been observed
      end to end by anyone who wrote it down.
- [ ] **Rebuild from nothing** on a throwaway VPS — the only way to turn the "total loss" row in §4
      from `unknown` into a number.
- [ ] **Confirm the volumes survive a redeploy** (`selfhost.md` names this as a house gotcha).
- [x] **Survive a power-off + resume of the whole box** — exercised involuntarily 2026-09-07: volume,
      env and every container came back; nothing had to be restored. What did NOT come back on its
      own: the KiriminAja sandbox allow-list (vendor side) — add "re-probe the vendor APIs" to any
      post-resume checklist.
- [ ] **Install `ops/tokophi-probe.sh` off-box with an alert channel and set a Vultr low-balance
      alert** — the two cheapest items on this page, and the only ones that would have turned the
      70-hour outage into a 15-minute one.

## 9. How to re-derive everything here

```bash
ssh -i ~/.ssh/tokophi_dev root@45.77.33.112 '
  df -h /;                                                   # disk headroom
  docker ps -a --format "{{.Names}}\t{{.Status}}" | grep -i backup;
  C=$(docker ps --format "{{.Names}}" | grep -m1 -i backup);
  docker exec $C sh -c "ls -1t /backups/*.dump";              # the REAL retention window
  docker inspect -f "{{.State.StartedAt}}" $C;                # compare to the newest dump
  pg_restore --list <newest dump> | head'                     # is the dump readable at all
```
Compare the oldest and newest dump timestamps. **If they are hours apart rather than days, §3 is still
true.**
