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
- [ ] N41 #3 — `store_shipping_methods` rows on prod vs seed intent (18 rows) vs dev
- [ ] N41 #4 — `reviews.product_id` NULL count on prod vs dev
- [ ] N41 #5 — `platform_payment_channels` + `platform_payout` on prod vs seed intent vs dev
- [ ] PARITY 1 — runtime identity (PG version, DB size, newest Drizzle stamp, image sha)
- [ ] PARITY 2 — migration parity (journal vs `drizzle.__drizzle_migrations`, both sides)
- [ ] PARITY 3 — schema parity (table/column/enum/index/policy counts, RLS enablement)
- [ ] PARITY 4 — tenant isolation aggregates (NULL/orphan `store_id`, cross-store refs)
- [ ] PARITY 5 — commerce integrity (orphans, impossible states, duplicate invoice numbers, negative stock, order totals)
- [ ] PARITY 6 — seed/config drift beyond N41's three (nav, cod chain spot-check — items 1–2 already refuted, re-verified cheaply)
- [ ] PARITY 7 — capacity: table sizes, dead tuples, disk headroom, backup recency
- [ ] Reusable read-only SQL script under `ops/`
- [ ] Record verdicts here + update `OPEN.md` / `NEXT.md` N41 (wave 7) entry
- [ ] PR (docs only, read-only measurements — DO NOT MERGE without review)

## Results

(to be filled after measurement)

### N41 seed-drift verdicts (the 3 never checked) — measured, see body

| # | Item | Verdict |
|---|---|---|
| 3 | `store_shipping_methods` | see below |
| 4 | `reviews.product_id` | see below |
| 5 | `platform_payment_channels` / `platform_payout` | see below |

NEXT: measurements running — results being appended.
