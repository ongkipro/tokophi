# N41 (wave 7) seed-drift 3-of-5 + DB-PARITY — read-only measurements

**Started:** 2026-08-12 · **Base:** `54ec917` (origin/main) · **Branch:** `docs/n41-seed-drift-parity`

## Scope

The two items the 2026-08-12 session close left in the 🟡 queue, both **read-only** against the
production DB (SSH, psql via the postgres container prefix) with the shared local dev DB
(`localhost:5433`) as comparison material:

1. **N41 (wave 7) seed drift — the 3 of 5 never checked against production:**
   `store_shipping_methods` (#3), `reviews.product_id` (#4),
   `platform_payment_channels`/`platform_payout` (#5).
2. **DB-PARITY** (`2026-08-05-database-screening.md`): the screening matrix, read-only —
   runtime identity, migration parity, schema parity, tenant isolation, commerce integrity,
   seed/config drift, capacity/backup recency.

**Hard boundary: NO writes to production, NO writes to the shared dev DB.** SELECT/catalog reads
only, `default_transaction_read_only = on` where scripted. `verify-ledger` (rollback-only write
txn) is **out of scope** — the screening doc itself gates it on explicit owner approval.

Note: store slug `batik-nusantara` → `batiknusantara` was renamed TODAY (PR #261, applied on prod
and dev). The rename is **not** drift.

## Plan

- [x] Handoff committed before measurements (this file)
- [x] N41 #3 — `store_shipping_methods` rows on prod vs seed intent (18 rows) vs dev
- [x] N41 #4 — `reviews.product_id` NULL count on prod vs dev
- [x] N41 #5 — `platform_payment_channels` + `platform_payout` on prod vs seed intent vs dev
- [x] PARITY 1 — runtime identity (PG version, DB size, newest Drizzle stamp, image sha)
- [x] PARITY 2 — migration parity (journal vs `drizzle.__drizzle_migrations`, both sides)
- [x] PARITY 3 — schema parity (table/column/enum/index/policy/grant diffs, RLS enablement)
- [x] PARITY 4 — tenant isolation aggregates (cross-store refs, 6 checks)
- [x] PARITY 5 — commerce integrity (dupes, negative stock, totals arithmetic, orphans)
- [x] PARITY 6 — seed/config drift beyond N41's three (couriers, COD chain, nav)
- [x] PARITY 7 — capacity: table sizes, dead tuples, disk headroom, backup recency
- [x] Reusable read-only SQL script under `ops/` → `ops/tokophi-db-parity-screen.sql`
- [x] Record verdicts here + update `OPEN.md` / `NEXT.md` N41 (wave 7) entry
- [x] PR (docs only, read-only measurements — DO NOT MERGE without review)

## Results — measured 2026-08-12 ~02:10 WIB

Production = Vultr 45.77.33.112, container resolved by `postgres-` prefix. Dev = shared local
`tokophi-db` (`localhost:5433`). Every number below is a query result from that run, not a copy
from an older doc. Reusable script: `ops/tokophi-db-parity-screen.sql`. **No write of any kind
was executed on either database** — sessions ran `SET default_transaction_read_only = on`.

Context that changed under the older docs: **production now holds 11 stores** (signup is open;
`amanahofficial`, `beautyinyu`, `difa-pack`, `hamandia`, `nerium-id`, `permata-store`,
`petanihandal`, `she-store`, `valoish-store`, `zanobyshop` + the demo `batiknusantara`) — the
"production holds 1 store" figure in `2026-08-12-session-close.md`/N29 notes is stale.

### N41 seed-drift verdicts (the 3 never checked)

| # | Item | Verdict |
|---|---|---|
| 3 | `store_shipping_methods` | **DRIFT confirmed** on the demo store; the 10 signup stores are the designed fallback, but it is the exact state N41 warned about |
| 4 | `reviews.product_id` | **Partial drift, small and fully backfillable** — 8 of 76 rows NULL; the catastrophic "no product carries a rating" version is REFUTED |
| 5 | `platform_payment_channels` / `platform_payout` | **REFUTED — no drift.** Both singletons present and populated, richer than seed intent |

So the final N41 (wave 7) tally: **items 1, 2, 5 refuted · item 3 drift · item 4 partial drift
(8 rows)**. Remediation candidates below were **not run** (read-only screen).

#### #3 `store_shipping_methods` — DRIFT

```sql
select s.slug, count(ssm.*) from stores s
  left join store_shipping_methods ssm on ssm.store_id = s.id group by s.slug;
```
Prod: `batiknusantara` **10 rows**, all other 10 stores **0 rows**. Dev (current seed intent):
`batiknusantara` **18 rows**.

Prod's 10: `anteraja:FLREG, idx:00, jne:REG23, jne:YES23, jnt:EZ, jtcargo:REG, lion:REGPACK,
sap:UDRREG, sicepat:REG, spx:1` — an older seed epoch. Vs seed intent (dev's 18):
- **Missing on prod: `spx:3` (SPX Economy)** — a `codAllowed` service on the COD rail. The prod
  demo store cannot offer SPX Economy (nor its COD) at checkout: `/api/public/ongkir` intersects
  platform couriers ∩ picked services, and the picked set has no `spx:3`.
- Missing: `anteraja:ND/SD`, `jnt:JND`, `lion:BIGPACK/BOSSPACK/JAGOPACK`, `ninja:Standard`,
  `sap:UDRONS`, `sicepat:GOKIL`.
- Present on prod but not in seed intent: `idx:00`, `jtcargo:REG` (couriers the seed now ships
  disabled — but prod `platform_couriers` has `idx`/`jtcargo` **enabled**, see PARITY 6, so these
  rows are live at checkout).

The 10 signup stores: 0 rows AND `store_settings.couriers` NULL on every store → checkout scope
falls back to the platform courier-level filter. That is the designed "merchant never opened the
card" path, not seed drift — but it means every real signup store offers every platform-enabled
courier's services until the merchant edits Pengiriman.

**Remediation candidate (needs a decision, one-shot SQL against prod):** insert the 8 missing
seed-intent rows for the demo store (or at minimum `spx:3`), and decide whether `idx:00` /
`jtcargo:REG` should stay picked. Not bundled here.

#### #4 `reviews.product_id` — partial drift, backfillable

```sql
select count(*), count(*) filter (where product_id is null) from reviews;
```
Prod: **76 reviews (all `batiknusantara`), 8 NULL** — 5 `terbit` + 3 `menunggu`. Dev: 197
reviews, 0 NULL. The 63 linked `terbit` reviews mean products **do** carry ratings on prod — the
entry's worst case is refuted; the residue is 8 rows.

All 8 NULL rows were checked name-by-name: **every `product_name` exactly matches a live product
title in the same store** (`Blazer Formal Wanita`, `Cardigan Rajut Wanita`, `Celana Kulot Wide
Leg`, `Dress Midi Motif Bunga`, `Gamis Syari Polos`, `Kemeja Oversized Wanita`, `Rok Plisket
Panjang`, `Set Piyama Satin Wanita`).

**Remediation candidate (not run):**
```sql
update reviews r set product_id = p.id from products p
 where r.product_id is null and p.store_id = r.store_id and p.title = r.product_name;
```

#### #5 `platform_payment_channels` / `platform_payout` — REFUTED

Prod `platform_payment_channels`: **16 rows, 7 enabled+active** (QRIS, VABCA, VAMANDIRI, VABNI,
VABRI, VAPERMATA, **OVO**; plus a 16th channel `VADANAMON`, disabled). Seed intent is 15 rows /
6 enabled — prod is a **superset** managed via super-admin Sync/toggle, nothing missing.
Prod `platform_payout`: exactly **1 row**, `selesai / 50 000 / auto_approve=f` — identical to
seed intent and to dev. Neither singleton is empty; the "older DB has zero payment channels"
scenario does not exist on this production.

### DB-PARITY screening matrix

| # | Area | Verdict |
|---|---|---|
| 1 | Runtime identity | **Parity.** Both PG 16.14 (alpine). Prod DB 26 MB, dev 36 MB. All 3 prod app containers on image tag `54ec9172…` = origin/main HEAD `54ec917`. Newest Drizzle stamp both sides `1786470181705` (0093) |
| 2 | Migration parity | **Prod = journal exactly** (94 applied, stamp list diffed element-by-element: no missing, no extra, no future stamp). **Dev carries 7 extra stamps** from unmerged branches (`1783655082681`, `1783655089996`, `1783656809681`, `1783656900000`, `1784005116988`, `1784109762290`, `1785774399036` — the last is `ka/flow-audit`'s 0087, the known collision) |
| 3 | Schema parity | **Prod matches the code.** Full diff of tables/columns/policies/enums/indexes/grants: the ONLY differences are on the **dev** side — `color_palettes` (table+policy+index+grants, the N25 orphan) and three orphan columns `orders.ship_kelurahan_id`, `orders.ship_kelurahan_name`, `store_settings.sender_zip` that exist in **no migration and not in `schema.ts` at HEAD** (push debris from an abandoned iteration). Enums identical (44), roles identical (`tokophi`, `tokophi_app`) |
| 4 | Tenant isolation | **Clean on prod.** 6 cross-store aggregates all **0** (line-items↔order store, collection_products, payments, ledger, inventory via location, orders↔customer). RLS: prod 51/78 tables enabled + 51 policies = dev minus `color_palettes`. `tokophi_app` still holds full DML on all 78 tables — that is **N16**, unchanged, now confirmed on prod |
| 5 | Commerce integrity | **Clean on prod** — 0 on all 9 checks (dup invoice/order numbers, negative stock, orders w/o lines, line-sum≠subtotal, total arithmetic, ledger sale w/o order, paid-order/payment agreement both directions) over 220 orders / 219 payments / 206 ledger entries. Dev: 15 orders with no line items (dev-only debris; everything else 0) |
| 6 | Seed/config drift | N41 items above. Re-verified refuted items 1–2: `platform_couriers.services` on the NEW dialect (`codAllowed` present on all 10 couriers), `spx` types 1 **and** 3 `codAllowed=true`; `platform_cod` enabled, cap Rp2.000.000, 6 provinces → COD chain intact platform-side. Demo nav has `Promo → /promo` (the 2026-07-30 fix, intact). **Observation:** courier enablement differs from seed intent — prod `idx=t, jtcargo=t, ninja=f`; seed/dev `idx=f, jtcargo=f, ninja=t`. Recorded as a finding (operator toggle vs old epoch — undecidable from the DB), not repaired |
| 7 | Capacity & backups | Disk `/` 169G total, **66G free (60% used)**. DB 26 MB; largest table `kelurahan` 8,7 MB; no table >500 dead tuples. **Backups: sidecar container `backup-*`, ~6-hourly `pg_dump` into a docker volume; newest `tokophi-20260811-154848.dump` (2026-08-11 22:48 WIB) = 3 h 21 m before measurement; ~30 dumps ≈ 7,5 days retention, 39 MB total — local-only** (offsite DR-1 still open, matches the session-close note) |

### Could not measure (and why)

- **`verify-ledger` FK-enforcement probe** — it opens a (rollback-only) **write** transaction on
  prod; the screening doc gates it on explicit owner approval and this task is hard-bounded to
  read-only. Skipped.
- **Index waste estimation** — prod has only `plpgsql` installed (no `pgstattuple`), and
  installing an extension is DDL. Sizes + dead-tuple counts stand in for it; at 26 MB total the
  question is moot.
- **Whether prod's courier-enablement delta (idx/jtcargo/ninja) is an operator decision or an old
  seed epoch** — the DB cannot answer intent; `platform_activity` was not mined for toggle events
  to keep the screen bounded. Flagged for the owner instead.

## Follow-ups filed (docs only, no repair bundled)

1. **N41 #3** — decide + apply the demo store's missing `store_shipping_methods` rows (at least
   `spx:3`); decide whether `idx:00`/`jtcargo:REG` stay. One-shot SQL, needs approval.
2. **N41 #4** — run the 8-row `UPDATE … FROM products` backfill above. Needs approval.
3. **Courier enablement** — confirm with the owner whether prod `idx`/`jtcargo` enabled +
   `ninja` disabled is intended; align seed or prod accordingly.
4. **Dev container hygiene** — `color_palettes` (N25) plus the three orphan columns
   (`orders.ship_kelurahan_*`, `store_settings.sender_zip`) and 7 unmerged migration stamps are
   dev-only debris; dropping them is destructive and stays a decision.
5. **Stale figure** — docs saying "production holds 1 store / 1 user" (N29 notes) must be
   re-measured before the rotation runbook runs: production holds **11 stores** now.

NEXT: nothing — measurements complete, verdicts recorded, OPEN.md/NEXT.md updated in this branch.
Remediations above are deliberately NOT executed; each needs its own approval.
