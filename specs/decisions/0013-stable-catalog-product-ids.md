# ADR 0013 — Stable, system-generated catalog product ids

**Status:** accepted
**Date:** 2026-07-29
**Supersedes:** the MVP decision in [ADR 0012 §0.2](0012-meta-commerce-tenant-owned-integration.md) that the
catalog id stays handle-derived, and [ADR 0012 §10](0012-meta-commerce-tenant-owned-integration.md)'s
`tokophi:{store_id}:{variant_id}` scheme (neither is what we ship).

---

## 1. Decision

Every product gets a **system-generated number, allocated per store and never reused**, and every
variant gets a **per-product `seq` that is never reused either**. The catalog identifier becomes:

```text
retailer id   = {products.number}-{product_variants.seq}      e.g. 1042-3
item_group_id = {products.number}                             e.g. 1042
```

Both are produced by **one helper** — `@tokophi/lib/tracking-ids` `retailerId()` / `itemGroupId()` —
called by the product feeds, the storefront pixel and the Conversions API alike.

**The scheme is per store** (`stores.catalog_id_scheme`): existing stores stay on `handle`, new stores
start on `number`, and a merchant switches when they choose. §5 explains why that is not timidity.

---

## 2. The problem this fixes

Until now the id was derived from the product HANDLE:

```text
single-variant product  →  kemeja-linen
n-th variant            →  kemeja-linen-2      (1-based, in `position` order)
```

Google, Meta and TikTok all key a catalog item by the id we send. So the id **is** the product's
identity to them — and this one changed under ordinary, one-click merchant actions:

| The merchant does this | The id becomes | Consequence at the provider |
|---|---|---|
| Renames the handle | every id changes | every item is replaced |
| Drags a variant to reorder | ids swap between variants | two items silently trade SKUs |
| Deletes the middle of three variants | `-3` becomes `-2` | the survivor **inherits the deleted variant's item**, its history and its audiences |
| Adds a second variant to a product | `kemeja-linen` → `kemeja-linen-1` + `-2` | the original item disappears |

That last row is the one that made this urgent: adding a variant is not an edge case, it is a normal
Tuesday, and it re-keyed the product every time.

**None of the three providers offers a re-key.** Google: *"Once you've assigned an ID to a product,
don't change it… If you change the ID, you'll overwrite your product and its history."* Meta's default
scheduled-upload mode is Replace, so the old `retailer_id` is deleted — taking any retargeting audience
built on that `content_id` with it. TikTok uses the id as the update key the same way.

`position` was carrying two jobs — display order **and** identity — and the second one was invisible.
It now carries one.

---

## 3. Why per-store numbers, and not the alternatives

| Option | Verdict |
|---|---|
| `tokophi:{store_id}:{variant_uuid}` (ADR 0012 §10) | Stable, but publishes the tenant's primary key to three ad platforms and is unreadable to the merchant who has to match it against a Merchant Center error. |
| One Postgres sequence per store | `tokophi_app` has no `CREATE` privilege, so provisioning would need an owner connection — the escape hatch the RLS discipline exists to prevent. |
| `select max(number)+1` in the write txn | Racy under READ COMMITTED: two concurrent creates compute the same number. Either the unique fires (a save the merchant cannot act on) or two products share a catalog id. |
| A global identity column | Simplest, but a public feed then leaks TokoΦ's total product count and its growth rate, and merchants get `#184417` instead of `#1001`. |
| **Per-store counter row, allocated in one statement** | **Chosen.** Dense, merchant-legible numbers; no cross-tenant disclosure; race-free without a retry. |

Allocation is a single statement, so two concurrent creates serialise on the counter row:

```sql
insert into store_counters (store_id, product_next) values ($1, 1002)
on conflict (store_id) do update set product_next = store_counters.product_next + 1
returning product_next - 1
```

Uniqueness only ever has to hold **inside one store**, because under ADR 0012 each merchant owns their
own catalog. `unique(store_id, number)` says exactly that.

**Variant numbers use a high-water mark** (`products.variant_seq_next`), not `max(seq)+1`:
`updateProduct` hard-deletes unreferenced variants, so `max(seq)` can go *down*, and reissuing a retired
number is precisely how a live catalog item gets re-pointed at a different SKU. The allocating UPDATE
also row-locks the product and, running under RLS, returns zero rows for a foreign `product_id` — so it
doubles as the CHILD-TABLE parent check before any variant is written.

---

## 4. Schema (migration 0081)

```text
products.number            integer  -- per-store, unique(store_id, number), allocate-once
products.variant_seq_next  integer  -- high-water mark, never decreases
product_variants.seq       integer  -- unique(product_id, seq), allocate-once
store_counters(store_id pk, product_next)   -- RLS, tenant_isolation
stores.catalog_id_scheme   text     -- 'handle' (existing) | 'number' (new)
```

Backfill is deterministic — products by `(created_at, handle)` within a store, variants by
`(position, id)` within a product — so a restored dump renumbers identically, and the old→new id map is
computable for a merchant reconciling their catalog. Each backfill is fenced on `IS NULL`: re-running
the migration must never renumber a live product, because renumbering **is** re-keying.

---

## 5. Switching an existing store is the merchant's decision

The re-key is one-way and destructive at the provider, so it is not something a migration does to
someone. `stores.catalog_id_scheme` defaults to `handle`; new stores are created with `number` and
never pay the cost at all.

A merchant switches from Pemasaran → Pelacakan, warned in plain Indonesian about what resets (riwayat
performa produk, audiens retargeting) and advised to pick a low-spend moment.

**The one thing that must never be split:** `<g:id>` and the pixel/CAPI `content_ids` have to flip in
the same instant for a store. A mismatch does not degrade matching — it silently **zeroes** it, which is
worse than the re-key. Both route through `retailerId()` with the scheme as a parameter, so this holds
by construction. That is why the scheme is a function argument and never an `if` at a call site.

---

## 6. Consequences

**Good:** renaming a handle, reordering variants, deleting a sibling and adding a first variant all
leave every surviving id byte-identical. `position` becomes display order only. The window functions
that derived the old ordinal disappear from the conversion payload. Merchants get a number they can
search for when a provider disapproves an item.

**Accepted:** numbers have gaps (a rolled-back create burns one — it is an identifier, never a count).
Two stores both have a `#1001`, which is fine because they have separate catalogs. And a store that
switches schemes pays the re-key once, deliberately.

**Landmine, recorded because it will bite:** `duplicateProduct` copies a product by spreading every
column (`omit(orig, ["id","createdAt"])`) — a pattern designed to pick up new columns automatically. It
must keep omitting `number`, or every "Salin produk" fails on the unique. The variants' `seq` values are
correctly copied, because a copy is a new product with an identical variant set.
