# Plugin menu in the sidebar + CRM audit → "Follow-up WA" as a derived queue

- **Date:** 2026-11-15 · **Status:** PROPOSED (owner decisions in §5 are open; defaults marked).
- **Owner request (2026-11-15):** "untuk plugins nanti ada plugins list -> menu plugin masuk ke sidebar
  mungkin di bawah tema bukan di pengaturan, kemudian scan crm sidebar secara sistem itu gimana bekerjanya
  jika kurang maksimal kamu riset dan kembangkan buat md dan task developmentnya".
- **Amends:** ADR 0021 §2.1 (menu location "Pengaturan → Plugin") — dated note appended to the ADR.
  Related: `specs/docs/KELOLA_PLUGIN_SPEC.md` §5 (retiring the in-house CRM), owner ruling 2026-11-03
  (CRM hidden for every store except the demo store until WABA).
- **Tasks:** `PLUG-NAV`, `CRM-FU-1` … `CRM-FU-4` in `specs/docs/TASKS.md`.

## 1. Where things stand (measured 2026-11-15, code on `main` + production read-only)

### 1.1 Plugins

| Piece | Today |
|---|---|
| Registry | `apps/admin/lib/plugins/registry.ts` — `PLUGINS = [kelolaPlugin]`; a plugin has `id`, `name`, `description`, `settingsHref`, `uninstall`, `onResume`, `onOrderCreated`, `onCron`. Nothing about navigation. |
| List + switch | A section inside Pengaturan: `/pengaturan?section=plugin` → `components/admin/pengaturan/plugin-card.tsx` (308 lines). Kelola's own settings also live there (`settingsHref: "/pengaturan?section=plugin"`). |
| Capability | `plugins:manage`, owner-only (ADR 0021 §2.6). |
| Production | 1 `store_plugins` row: Kelola on the demo store, `enabled = false`. |

A plugin that is switched on adds **no sidebar entry**: an owner who turns Kelola on has to remember
that it lives inside Pengaturan. That contradicts the plugin contract's own promise ("no row = no menu
entry", ADR 0021 §2.2), because there is no "menu entry" mechanism at all.

### 1.2 CRM (sidebar: CRM → Follow-up WA · Pipeline · Template)

| Piece | How it works today |
|---|---|
| Gate | `crmEnabled(slug)` — a hard-coded slug set `CRM_STORE_SLUGS = {"batiknusantara"}` in `lib/nav.ts`, mirrored by `crm/layout.tsx` (404 elsewhere). Owner ruling 2026-11-03. |
| `/crm` | Dashboard: "Perlu follow-up hari ini", active prospects, pipeline value, "Menang bulan ini". |
| `/crm/followup` | List of `followups` rows; "Kirim WA" opens `wa.me` with a filled template; "Selesai" sets the row `selesai`. |
| `/crm/pipeline` | Manual prospects (`leads`): create, move stage (baru → dihubungi → nego → closing → menang/kalah), delete. |
| `/crm/template` | CRUD of `wa_templates` per follow-up type. |
| Writers | `followups`: **only** `lib/actions/checkout.ts` (Keranjang Ditinggal → "WA dibuka" writes a `keranjang` row) and the seed. `leads`: only the manual form and the seed. `wa_messages`: **no writer at all**. |

**Production, read-only aggregates (2026-11-15):** `followups` = 10 rows, `leads` = 12 rows, all on the
demo store, every date in June–July 2026 — i.e. **seed data only**; `wa_messages` = 0; abandoned carts
with a phone in the last 30 days = 0. Five of the six follow-up types (`pembayaran`, `konfirmasi`,
`pascabeli`, `repeat`, `ulasan`) have **no code path that creates them** from a real order.

**Verdict — "kurang maksimal", concretely:**
1. **It does not watch the shop.** A follow-up queue that only fills when a human types a row is a
   to-do list, not a CRM. The real signals already exist in our tables (unpaid prepaid bills, COD orders
   waiting for confirmation, delivered orders, lapsed customers, abandoned carts) — nothing reads them.
2. **It duplicates state.** A `followups` row copies the customer, phone and context at write time;
   when the order moves on (paid, cancelled) the row does not, so a future generator would show stale work.
3. **Pipeline is the wrong tool for this market's seller.** A sales funnel for named prospects fits B2B;
   a COD/marketplace seller's "prospects" are carts and chats, which we already have (Keranjang Ditinggal,
   Obrolan). It has 12 seed rows and no real use.
4. **The gate is a slug list in code**, not a per-store choice — exactly what the plugin switch exists for.
5. **`wa_messages` is a dead table**: there is no send API (wa.me only opens the seller's own WhatsApp),
   and the UI must never claim "terkirim" (AGENTS.md: "WA dibuka", never "terkirim").

## 2. Research (what sellers here use, what the platforms do)

- Indonesian order tools ship WhatsApp follow-up as a core seller feature (OrderOnline.id announced
  automatic follow-up messages in 2023 — [IndoTelko](https://www.indotelko.com/read/1683823751/kini-ada-fitur-pesan-follow-up-otomatis-di-orderonlineid)).
  The common shape in order-status automation tools: a template bound to an order state, filled with the
  order's fields ([BusinessChat](https://help.businesschat.io/en/articles/7906990-whatsapp-templates-order-status-notification)),
  plus a delayed post-purchase check ([Zapier/WooCommerce pattern](https://zapier.com/templates/details/d0d8c85ebfac6280035fa38670391e40f0a74a257c0147b7b53562f1593911e9)).
- Fully automatic sending needs the WhatsApp Business Platform with approved templates; outside the 24-hour
  service window only templates can be sent and are charged per message ([Meta pricing](https://developers.facebook.com/docs/whatsapp/pricing)).
  Secondary sources report that utility templates inside the window also became billable on 2026-10-01
  ([WATI](https://support.wati.io/en/articles/11561662-message-based-pricing-all-you-need-to-know)) —
  **unverified against Meta's current page; re-check before CRM-FU-4.**
- Shopify puts installed apps' pages in the admin sidebar, one level deep, contributed by the app
  ([`s-app-nav`](https://shopify.dev/docs/api/app-home/app-bridge-web-components/app-nav)) — the pattern
  the owner is asking for, minus the marketplace.

## 3. Design

### 3.1 PLUG-NAV — "Plugin" in the sidebar, under Tema

- Sidebar group **Toko Online**: `Tema` → **`Plugin`** → `Halaman` → `Blog` → `Files` → `Navigasi`
  (owner: "di bawah tema"). Icon `Plug`.
- `Plugin` row → **`/plugin`**: the list of every compiled-in plugin (name, description, state badge
  Aktif / Nonaktif / Belum dipasang, Aktifkan / Nonaktifkan / Hapus koneksi — the existing `PluginCard`
  logic moved, not rewritten). `/pengaturan?section=plugin` **redirects** to `/plugin` (old links keep
  working); the Pengaturan section is removed.
- **A plugin contributes its own menu rows.** `Plugin` type gains
  `nav?: { label: string; href: string; capability?: Capability }[]`. When the store has the plugin
  `enabled`, its rows appear as **children of `Plugin`** (one level, like Shopify). A store with no active
  plugin sees `Plugin` with no children (the parent still opens the list).
- One source for every navigation surface: the admin layout reads this store's enabled plugin ids
  (one indexed read on `store_plugins`) and hands them down the same way `buyerAccounts` is handed down;
  `navGroupsFor(slug, { buyerAccounts, plugins })` builds the children, so the sidebar, the phone drawer
  and the Ctrl/Cmd+K palette agree (they all call `navGroupsFor` today).
- **Hiding is not a gate:** each plugin page's layout re-checks `enabled` server-side and 404s, exactly
  like `crm/layout.tsx` does now. `/plugin` itself: visible to everyone who can see settings; the switches
  stay `plugins:manage` (owner-only) in the action, never only in the UI.
- Kelola moves to `/plugin/kelola` (its connect/test/send-history UI) and its `settingsHref` changes;
  `nav: [{ label: "Kelola CRM", href: "/plugin/kelola" }]`.

### 3.2 CRM-FU — "Follow-up WA" becomes a first-party plugin with a DERIVED queue

Default proposal (decision D1 below): keep a built-in follow-up tool — it is useful to every store, costs
no third party, and works today without WABA — but rebuild it so it **reads the shop instead of waiting
for typed rows**, and ship it as plugin `followup-wa` ("Follow-up WA") so each store opts in. Kelola stays
the external CRM option; the two are independent.

**The queue is computed, never copied** (same rule as the dashboard: one source, the order rows). Each
item is `(type, subject_id)` derived live from existing tables, WIB days via `dayKey()`:

| Type (existing enum) | Source rule (proposed defaults, tunable later) | Message gist |
|---|---|---|
| `keranjang` | `checkout_sessions` `ditinggal`, phone present, abandoned ≤ 7 days, not recovered | reuse the existing signed recovery link (`apps/storefront/src/lib/recovery.ts`) |
| `pembayaran` | prepaid order `baru`, its payment `menunggu`, older than 60 min and still payable (`instructionState`, `lib/pay-retry.ts`) | order number + total + how to pay; no secret in the message |
| `konfirmasi` | COD order `baru`/`diproses`, no shipment booked yet, older than 30 min | confirm name/address before booking — lowers RTS |
| `pascabeli` | order `selesai` 1–3 days ago | "sudah sampai?" |
| `ulasan` | order `selesai` 3–10 days ago, no review by that customer on its products | link to the product page |
| `repeat` | customer with ≥ 1 `selesai` order, last order 30–90 days ago, nothing newer | soft re-engagement |

- **`followups` turns into the ACTION log**, not the queue: one row per `(store_id, type, subject_id)`
  the seller acted on — `dibuka` (WA opened — still "WA dibuka", never "terkirim"), `selesai`, `lewati` —
  with `acted_at` and the user. The queue = derived items minus acted-on ones. Migration (hand-written,
  idempotent): `followups.subject_id uuid`, `followups.acted_by uuid`, unique `(store_id, type, subject_id)`
  where `subject_id is not null`, enum values for the new statuses via `do $$ … exception` blocks.
  Existing rows (seed only) keep `subject_id` NULL and drop out of the queue.
- **Templates:** `wa_templates` per type, with a built-in default per type in code when the store has
  none (the `DEFAULT_CART_TEMPLATE` pattern in `lib/cart-message.ts`) — the seed does not reach existing
  stores, so defaults cannot depend on it.
- **Pages:** `/crm/followup` (queue, filter by type, "Kirim WA" = open `wa.me` + log `dibuka`,
  "Selesai", "Lewati") and `/crm/template`. `/crm` dashboard keeps only real numbers: items per type
  today, WA opened this week, and per type "dibayar/selesai setelah dihubungi" labelled as our own
  last-touch estimate. URLs stay `/crm/*` (they are hidden everywhere but the demo store today, so nothing
  public breaks); the plugin's `nav` lists them under `Plugin`.
- **Pipeline (`/crm/pipeline`, `leads`) is removed** (decision D2), together with `wa_messages`
  (no writer). Data: production holds only the demo store's seed rows; export-then-drop in a separate
  migration PR, never with the UI change (KELOLA_PLUGIN_SPEC §5 step 3).
- **Gate:** `CRM_STORE_SLUGS` / `crmEnabled` deleted; the gate becomes "plugin `followup-wa` enabled for
  this store". `crm:write` stays (admin, staff, cs use the queue); activation stays `plugins:manage`.
- **Never on the order path:** the queue is a read model in `lib/data/followup-queue.ts`; no hook writes
  to it, no order/payment/ledger row is touched (the plugin contract's "never writes `orders.status`").

### 3.3 Later — real sending (CRM-FU-4, not in v1)

WhatsApp Business Platform (WABA) with approved utility templates per type, opt-in per store, cost shown
to the seller before activation; until then everything is `wa.me` (the seller's own phone, one click per
message). This is the owner's 2026-11-03 condition for opening CRM widely; D3 asks whether the wa.me
version may open earlier as an opt-in plugin.

## 4. Acceptance

- **PLUG-NAV:** `Plugin` sits directly under `Tema` in the sidebar, the phone drawer and the palette;
  `/plugin` lists Kelola with its real state; `/pengaturan?section=plugin` → 308/redirect to `/plugin`;
  activating Kelola adds "Kelola CRM" under `Plugin` in all three surfaces; deactivating removes it and a
  typed `/plugin/kelola` then answers 404; a non-owner cannot flip a switch (action-level test). `nav.test`/palette tests cover a store with
  0, 1 and 2 active plugins. `PAGE_MAP.md` regenerated; `rbac-census` unchanged or updated.
- **CRM-FU-1:** for each type, a real-Postgres test builds the scenario and asserts the item appears,
  disappears once the source moves on (paid, cancelled, shipped, reviewed, re-ordered) and disappears once
  acted on; tenant test (store A never sees store B); no write to `orders`/`payments`/`ledger_entries`
  from any queue path (`codeOnly` guard over the new files, proved red on a mutated copy). Browser:
  queue, Kirim WA, Selesai, Lewati at 390 px and 1440 px, 0 console errors, on the demo store.
- **CRM-FU-2:** `/crm/pipeline` gone (404/redirect), `leads` + `wa_messages` dropped only after the
  export PR; `verify-migrations` + `verify-rls` green.

## 5. Owner decisions (defaults in force until answered)

| # | Question | Default |
|---|---|---|
| D1 | Keep a built-in follow-up tool (as plugin `followup-wa`) next to Kelola, or retire the in-house CRM entirely in favour of Kelola (KELOLA_PLUGIN_SPEC §5 as written)? | **Keep, as a plugin, rebuilt as a derived queue** |
| D2 | Pipeline (manual prospects) | **Remove** (seed data only; carts + chat cover this seller's prospects) |
| D3 | May `followup-wa` (wa.me, one click per message) be activatable by any store now, or stay demo-only until WABA (ruling 2026-11-03)? | **Demo-only until the owner says otherwise**; the plugin switch replaces the slug list either way |
| D4 | Time windows in §3.2 (60 min unpaid, 30 min COD confirm, 1–3 / 3–10 / 30–90 days) | as listed; per-store tuning later |
| D5 | Menu label: "Plugin" (ADR 0021) or "Aplikasi"? | **"Plugin"** (no marketplace; matches AdsBookCMS) |
