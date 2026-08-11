# N41 remediations EXECUTED on production + the two audit gaps closed — 2026-08-12 ~03:00 WIB

Owner-approved this session, in the owner's own words ("setujui dua SQL N41, eksekusi"). Every
number below is from the run itself, not predicted.

## ① The two approved SQLs — one transaction, `ON_ERROR_STOP`, counts before/after

**N41 #3 — demo store `store_shipping_methods`:** inserted the seed-intent rows via
`INSERT … ON CONFLICT (store_id, courier, service) DO NOTHING` sourced from the 18-row dev seed
intent. Result: **10 → 20 rows, `INSERT 0 10`** (`anteraja:ND/SD`, `jnt:JND`,
`lion:BIGPACK/BOSSPACK/JAGOPACK`, `ninja:Standard`, `sap:UDRONS`, `sicepat:GOKIL`, **`spx:3`** —
the COD rail is picked again). `idx:00` and `jtcargo:REG` were deliberately LEFT (their courier
toggles are live on prod — see ③). `ninja:Standard` is picked-but-inert (platform ninja disabled).

⚠️ **Attribution, so nobody re-diagnoses this**: the parallel read-only audit later observed
"10 new rows at txid 45536, written after 02:19 WIB, not by me". **That was this remediation** —
same 10 services, same session, minutes apart. The books balance.

**N41 #4 — `reviews.product_id` backfill:** the audited `UPDATE … FROM products` on
title-in-same-store match. Result: **`UPDATE 8` exactly, NULL 8 → 0** of 76 reviews.

## ② `verify-ledger` FK probe on production — the screening's last "could not measure"

Run inside the admin container (credential never left the box), 2026-08-12: **all green** —
0 orphans on every child table, every FK VALIDATED **and proven to fire today** (the dangling
insert was refused), `available` Rp21.032.562 + `pending` Rp23.424.347 both fully backed by
orders. **Rollback confirmed**: `fk-probe-%` store count = 0 afterwards.

## ③ Courier enablement (prod `idx=t, jtcargo=t, ninja=f`) — VERDICT: operator decision

Read-only forensics (platform_activity mining + git seed-epoch archaeology + `xmin` bracketing):

- **No seed epoch ever set `idx=t`/`jtcargo=t`** (both the 2026-07-10 prod-seed epoch `806b285`
  and today's seed say idx=f, jtcargo=f, ninja=t; no migration touches `enabled`). The prod state
  therefore HAD to come from a post-seed application write, and `saveCouriers()` is the only
  writer that flips `enabled` on existing rows.
- The operator demonstrably worked that same settings card on **2026-07-16** (the logged
  per-service COD change whose result exactly matches today's `codAllowed` state), and `xmin`
  shows no `platform_couriers` write after that day — stable ~4 weeks.
- Why there is no toggle log to find: **`saveCouriers` never calls `logPlatform`** — unlike its
  siblings `saveGateways`/`saveCodAllowed` (`apps/super-admin/lib/actions.ts:416`). The question
  was structurally unanswerable from the audit log.

**Recommendation (needs one-line owner confirmation, evidence is inferential):** align the SEED
to prod — `COURIERS_OFF` drops `idx`/`jtcargo`, gains `ninja` — and, independently of that
decision, **add `logPlatform` to `saveCouriers`** so this question can never be unanswerable
again. Both filed as follow-ups below.

## ④ N29 re-measured — the rotation population has CHANGED SHAPE, urgency DOWN

Fresh read-only counts (2026-08-12): **12 stores** (11 owned + the ownerless `tema-platform`
theme holder — that "anomaly" is #262's designed platform holder, fixed UUID, no `store_users`
on purpose, carrying no credential), **11 users** (all owners, 0 without membership),
**1 platform admin**, customers 0/33 with hashes. **The 7 old seed demo stores and `toko-tes`
no longer exist on prod** — the runbook's 2026-08-03 population is almost entirely gone.

- **10 of 11 owners are real self-serve merchants** (signup events match `users.created_at` to
  the millisecond) — self-chosen passwords, OUT of rotation scope. "Rotate the accounts that were
  measured, never the table" now protects real customers.
- **The ≤2 seed-epoch principals were BOTH already rewritten post-seed** (`xmin` between
  07-16 and 08-08): the platform admin's address is no longer `admin@tokophi.id`, and the demo
  owner's is no longer the published constant. Password state was NOT verified (read-only bound)
  — if the owner wants certainty, re-run runbook §① against today's 12-principal population.
- Net: N29 drops from "live security hole" to "owner double-checks 2 accounts he already touched".

## Follow-ups filed here (board files deliberately untouched — another session holds them)

1. **Seed alignment** `COURIERS_OFF` → match prod (`idx`,`jtcargo` on / `ninja` off) — after the
   owner's one-line confirmation of ③.
2. **`saveCouriers` logging gap** — add `logPlatform`, the same shape as `saveCodAllowed`. Small.
3. **Runbook N29** — carry ④'s numbers; note `tema-platform` is invisible to owner-membership
   queries by design and holds no credential.
4. Still open, unchanged: decide `idx:00`/`jtcargo:REG` staying in the demo store's picked set.
