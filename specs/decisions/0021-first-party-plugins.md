# ADR 0021 — First-party plugins: compiled in, activated per store, never a marketplace

**Status:** accepted for v1 · **Date:** 2026-11-13 · **Decided by:** the owner's direction of 2026-11-13 (the Seller
CRM is retired; CRM moves to Kelola, `kelolatim.com`, delivered as a plugin). The boundary defaults below are
still open for confirmation in `specs/docs/KELOLA_PLUGIN_SPEC.md` §7 — a change there amends this ADR.
**Amends:** PRD positioning ("No Apps / plugins marketplace") — the marketplace ban stands; first-party plugins
are allowed. **Reference implementation:** AdsBookCMS ADR-027 + ADR-028 (`ongkipro/adsbookcms`).

## 1. Context

The PRD said "❌ No Apps / plugins marketplace. The feature set is curated in-core." The owner now wants an
optional integration — Kelola CRM — that most stores will never use, that must cost a non-adopting store
nothing, and that carries shopper PII to a third party for the stores that do adopt it. AdsBookCMS already
ships exactly this (ADR-027: optional integrations ship dormant; ADR-028: first-party plugins installed per
store on activation), including the Kelola plugin itself. Building the same shape here keeps one Kelola
workspace receiving identical data from both products.

## 2. Decision

1. **A plugin is first-party product code** under `apps/admin/lib/plugins/<id>/`, compiled in and written by
   us. No upload, no customer code, no third-party submissions, no runtime for foreign code. The marketplace
   ban in the PRD stands; this ADR only allows a curated switchboard. Seller UI name: **Plugin**
   (Pengaturan → Plugin), never "Apps".
2. **Installed means activated, per store.** A `store_plugins` row (store_id, plugin) is written when the
   owner activates it. **No row = dormant = zero effect**: no outbound request, no plugin rows, no Seller
   panel, no checkout change. The only allowed cost is one indexed read in the order hook and the cron.
3. **The core calls plugins through two hooks only** (`lib/plugins/registry.ts`): `runOrderCreated`, scheduled
   with `after()` by the public order route strictly AFTER its transaction returns (pinned by
   `order-hook-position.test.ts`), and `runPluginCron` from `api/cron/plugins` (`cron-plugins` sidecar,
   900 s). Each plugin's failure is isolated and logged; it never fails an order or the cron.
4. **Schema** — forced difference from AdsBookCMS (one Postgres, many tenants): plugin tables ship in a
   normal hand-written migration as `plugin_<id>_*`, store-scoped with RLS; uninstall ("Hapus data")
   deletes THIS store's rows rather than dropping tables. **No plugin adds columns to core tables** —
   AdsBookCMS added `orders.kelola_*` and removed them (its 0066); we start where it ended.
5. **Credentials** are tenant-owned (ADR 0012 shape): sealed with `encryptSecret` under
   `INTEGRATION_TOKEN_KEY`, scope `<plugin>:<store_id>:v<n>`; never returned to a browser; any provider token
   that rides in a URL is redacted from every log and stored error (`@tokophi/lib/redact`).
6. **Capability `plugins:manage`, owner-only.** Not `integrations:write`: `advertiser` holds that one, and a
   plugin like Kelola ships every order's shopper name, WhatsApp and address to a processor.
7. **A plugin never writes `orders.status`** or any money/ledger row. `applyOrderStatusChange` stays the one
   writer. Kelola v1 is a one-way CRM mirror (spec §3.1 option A).

## 3. Consequences

- A store that never activates a plugin behaves exactly as before; a release that adds a plugin needs no
  per-store decision.
- A new optional integration is built as a plugin by default, not as core columns behind a flag.
- Kelola's create-only API means post-push state changes are not synced (stated `// lazy:` ceiling, spec §4.4).
- Adding a plugin means a folder, a registry entry and a migration for its own tables. No new cron sidecar
  and no new liveness row: the one `plugins` job runs every plugin.

## 4. Rejected

- **A third-party plugin marketplace** — reverses the curated-product positioning and opens a code-execution
  surface on the checkout origin. Out of scope; would need its own ADR.
- **Kelola as core columns behind a flag** — AdsBookCMS tried it (0063–0065) and undid it (0066).
- **A generic outbox table enqueued inside the order transaction** — unnecessary: the queue is derived
  (`orders LEFT JOIN plugin_kelola_orders`), and a claim statement before each POST gives one sender at a time.
