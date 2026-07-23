# ADR 0011 — Standard product taxonomy (Google Product Category), separate from the merchant's own category

**Status:** accepted (2026-07-23) · Phase 1 (taxonomy + picker + suggest) shipped · Phase 2 (feed
attributes) + Phase 3 (Google feed endpoint) shipped 2026-07-24.

## Context

A product had ONE category field: `products.category` — free text, chosen from a hardcoded
7-item list in the editor (`Dress`, `Atasan`, …). That is the **merchant's own label**, read all
over the UI (product-list filter + facet count, product cards, storefront `ProductCard`/search,
CSV exports, and — by name-slug — collection membership). It is fine for what it is: how a shop
organises *its own* catalogue.

What was **missing** is a **standardised, global taxonomy**. A commerce platform whose merchants
run Meta / TikTok / Google ads (the product copy already names all three) cannot generate a
compliant **product feed** without it. Google Merchant Center **requires `google_product_category`**
for Apparel, and Meta/TikTok catalogs consume the same field. A pile of free-text categories has no
anchor to any of those.

Conflating the two — replacing `category` with a Google id — would be wrong: it throws away the
merchant's own organisation and forces a 5,595-node taxonomy on someone who just wants a "Promo
Gajian" shelf. Shopify keeps them **separate**: a product has a *Product category* (Shopify Standard
Taxonomy → maps to Google) **and** collections **and** tags.

## Decision — three distinct layers, kept apart

| Layer | Owner | Field(s) | Purpose |
|---|---|---|---|
| 1. Collections | merchant | `collections` (+ conditions) | the shop's own shelves ("Koleksi Lebaran") |
| 2. Category label | merchant | `products.category` (free text) | the merchant's own quick label; **kept, unchanged** |
| 3. **Standard taxonomy** | **platform ref data** | **`products.google_category_id` + `google_category_path`** | Google/Meta/TikTok feeds, marketplace precision |

- **Reference table `product_taxonomy`** (global, NOT store-scoped, no RLS — same class as
  `kiriminaja_areas`/`kelurahan`): `id` (Google's own numeric id), `path`, `name` (leaf),
  `parent_id`, `is_leaf`. Seeded from the committed
  `packages/db/data/google-taxonomy.en-US.txt` (Google Product Taxonomy 2021-09-21, 5,595 rows)
  via an idempotent `seed-taxonomy.ts` wired into the deploy migrate chain.
- **`products.google_category_id`** (int, nullable, FK → `product_taxonomy.id`) + a cached
  **`google_category_path`** (text) so feeds/display never need the join.

## Auto-suggest (so the seller does not fill it manually — the Shopify behaviour)

Phase 1 ships a **deterministic Indonesian-fashion suggester** (`@tokophi/lib/taxonomy-suggest`):
a curated map of Indonesian garment terms → Google leaf id (dress/gamis/gaun → 2271 Dresses;
blouse/atasan/kemeja/tunik → 212 Shirts & Tops; rok → 1581 Skirts; celana/kulot → 204 Pants;
jumpsuit → 5250; blazer/jaket/outer/cardigan → 5598 Coats & Jackets; setelan → 1594 Suits;
piyama/daster → 2580 Pajamas; hijab/khimar/kerudung → 177 Scarves & Shawls; …). The editor matches
the product **title** against it and offers the hit as **"Disarankan: <path> — Terapkan"** — the
seller confirms with one click, and can always override via the searchable picker.

- **Why a curated map, not an LLM, for Phase 1:** deterministic, offline, zero cost/latency, and it
  covers the demo niche + typical ID fashion sellers. It is a *suggestion*, never a silent write —
  the picker is the source of truth. An AI classifier that generalises beyond fashion is a clean
  Phase-2 swap behind the same "suggest" seam.

## UI

Product editor → "Organisasi" card gains **"Kategori Google"**: shows the current path (or "Belum
diatur" + the auto-suggestion), and an **"Ubah"** button opening a **Dialog** with a debounced
search `Input` over `searchTaxonomy(q)` (server action, `ILIKE` on `path`). Base UI has no Select,
so this is a Dialog+Input+results-list, consistent with the stock/PO dialogs.

## Consequences

- `products.category` behaviour is untouched — no surface breaks.
- Existing products are backfilled by the suggester (from their `category`/title) during
  `seed-taxonomy`; unmatched stay NULL (honest — better than a wrong category on a feed).
- **Phase 2** — apparel feed attributes Google requires: `gender`, `age_group`, `material` on the
  product; `color`/`size` mapped from the existing variant options (Warna/Ukuran); `brand` from
  `vendor`; `gtin` from the (backlogged) barcode.
- **Phase 3** — per-store feed endpoints (`/feed/google.xml`, `/feed/meta.csv`).
- The taxonomy is versioned data (Google 2021-09-21). Refreshing it later = re-seed the newer file;
  ids are stable across Google versions, so stored `google_category_id`s survive.
