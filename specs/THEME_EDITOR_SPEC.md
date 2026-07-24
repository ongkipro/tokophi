# Theme Editor Overhaul — a Shopify-grade Store Builder

> Development spec. Goal: make **Tema** (Store Builder) feel like the Shopify theme editor — light
> navigation, a real **image picker** (upload / library / URL / pick product / pick category / search),
> a **link picker**, a **complete section library**, and **default templates** for Home / Category /
> Product that render on the storefront. Tracks work; check items off as they land.

Owner surface: `apps/admin` → `/tema` (list) + `/tema/[id]` (Puck builder).
Storefront consumer: `apps/storefront` (Astro SSR), templates resolved by `Host` + `resolveTemplate`.

---

## 1. Current state (analysis, 2026-07-25)

**Stack**
- Builder: **Puck `^0.20.2`** (`@measured/puck`) at `apps/admin/app/(admin)/tema/[id]/builder-client.tsx`.
- Field config: `apps/admin/lib/theme/puck-config.tsx` (one Puck component per section).
- Field UI: `overrides.fieldTypes` in `apps/admin/lib/theme/puck-field-overrides.tsx` — our shadcn/Base-UI
  `Input`/`Textarea`/native `select` swapped in for Puck's default inputs. **Only `text/textarea/number/select`
  are overridden today.**
- Section registry (shared): `packages/sections/src/registry.ts` — `SectionType`, `SECTION_TYPES`,
  `SECTION_LABELS`, `SECTION_DEFAULTS`, and one `*Config` type per section.
- Storefront render: `apps/storefront/src/components/sections/*` + `SectionRenderer.astro`.
- Admin preview render: `apps/admin/components/theme/sections/*` (React mirrors of the Astro sections).
- Persistence: `page_templates.sections` (JSON, Puck `Data` shape) via `saveTemplate`; brand colour +
  gallery layout live on `stores` (separate dialogs).

**Sections shipping today (11):** `hero`, `image-text`, `product-grid`, `category-nav`,
`collection-bento`, `lookbook`, `banner-promo`, `marquee`, `testimoni`, `blog` (labelled "Jurnal"),
`rich-text`.

**Media** — already built, NOT wired into the builder:
- `media` table (store-scoped, RLS). `apps/admin/lib/actions/media.ts`: `getMedia()` (list),
  `uploadMedia(FormData)`, `deleteMedia(id)`; product uploads also register into `media`.
- Files browser UI exists: `apps/admin/app/(admin)/files/files-client.tsx`.
- `image-store.ts`: `saveImage` → `public/uploads/` (local) / MinIO-S3 (VPS), 5 MB cap, returns
  `{url,width,height,mime,size}`.

**Templates**
- **Only the demo `homepage` is seeded** (`packages/db/src/seed-templates.ts`, UPSERT every deploy).
- **No Category or Product default template.** Storefront `resolveTemplate(templates, id, fallback)`
  returns the assigned template → the type default → `null` (hand-built page). So today Category/Product
  pages fall back to hand-built layouts; the builder can create them but there is no starting point.
- Storefront already renders templates for all three types: `pages/index.astro` (home),
  `pages/kategori/[handle].astro` (category), `pages/produk/[handle].astro` (product) via `SectionRenderer`.

**Data available for pickers:** `getProducts()` (`lib/data/products.ts`), `getCollections()`
(`lib/data/collections.ts`), `getMedia()` (media library).

---

## 2. Gaps vs. the Shopify theme editor

1. **Image field is a bare URL text box** (`type:"text"`, label "URL Gambar …") — image #19. No upload,
   no library grid, no "pick a product/category image", no search. **← the headline ask.**
2. **Link fields are bare text** (`ctaHref`, `href`). Shopify offers a link picker: product / collection /
   page / external URL, with search.
3. **No Category / Product default templates** to start customising from ("bahan custom kita").
4. **Section library is partial** vs Shopify's set (see §5).
5. **Builder navigation** is Puck-default; can be lighter/clearer (section list, add-section flow,
   per-section move/duplicate/hide, clearer empty state) to match Shopify's ease.

---

## 3. Phase plan (sequenced, each phase ships + deploys on its own)

- [ ] **P1 — Image picker custom field** (image #19). A Puck `type:"custom"` field with a modal:
      tabs **Upload · Galeri (library) · URL · Produk · Kategori**, each searchable. Returns a URL string
      (back-compat with today's stored value). Wire it into every image field in `puck-config.tsx`.
- [ ] **P2 — Link picker custom field.** Same modal pattern for `ctaHref`/`href`: **Produk · Kategori ·
      Halaman · URL**, search; returns a path string (`/produk/…`, `/kategori/…`, `/halaman/…`, or raw URL).
- [ ] **P3 — Default templates: Category + Product.** Seed a sensible default for each type (assignable,
      customisable), rendered by the storefront. Home already seeded.
- [ ] **P4 — Section library completion** (see §5) — add the missing high-value sections, shared across
      admin preview + storefront + registry, verified end to end.
- [ ] **P5 — Builder UX polish** — Shopify-like navigation (section outline, add-section picker with
      thumbnails, move/duplicate/hide, tidy field panel groupings), reusing our design tokens.
- [ ] **P6 — Storefront wiring audit** — every section renders on every template type it is valid for,
      no console errors, responsive 320–1280, brand tokens applied.

Ship P1 first (highest value, all infra exists), then P2/P3 in either order, then P4/P5.

---

## 4. P1 — Image picker (detailed spec)

**Component:** `apps/admin/components/theme/image-picker.tsx` (client). Rendered by a Puck custom field.

**Wiring:** in `puck-config.tsx`, change each image field from
```ts
imageUrl: { type: "text", label: "…" }
```
to
```ts
imageUrl: { type: "custom", label: "…", render: (p) => <ImagePickerField {...p} /> }
```
`CustomFieldRender` gives `{ field, name, id, value, onChange, readOnly }`. `value` is the stored URL
string; `onChange(url)` writes it back. **Value stays a plain URL string** → zero migration, existing
templates keep working.

**UI:** a trigger showing the current image thumbnail (or an empty dropzone) + "Ganti/Pilih Gambar".
Opens a `Dialog` with tabs:

| Tab | Source | Action |
|---|---|---|
| **Upload** | `uploadMedia(FormData)` | drag-drop / file input → upload → auto-select the new URL |
| **Galeri** | `getMedia()` | grid of the store's images, searchable by filename → click to pick |
| **URL** | — | paste an external/absolute URL or a `/path` |
| **Produk** | `getProducts()` | searchable list; pick a product → use its primary `image` |
| **Kategori** | `getCollections()` (+ a representative image) | searchable; pick a category image |

Notes:
- Data is fetched via server actions/data fns exposed to the client (thin `"use server"` wrappers or a
  small `/api` route; prefer server actions returning JSON). Product/category images come from
  `products.image` / a collection's first product image.
- "Kosong = gradasi warna brand" semantics preserved: a **Clear** button sets `""`.
- Uploads honour `media:write` (already enforced in `uploadMedia`).
- Reuse the Files grid styling from `files-client.tsx` for visual consistency.

**Definition of done:** every `imageUrl`/image field in `puck-config.tsx` uses the picker; upload +
library + URL + product + category all set the value; storefront renders the chosen image unchanged;
admin builds clean; screenshot on desktop.

---

## 5. Section library — current → target (P4)

**Have (11):** hero, image-text, product-grid, category-nav, collection-bento, lookbook, banner-promo,
marquee, testimoni, blog, rich-text.

**Add (high value, Shopify parity), each = registry type + `*Config` + admin preview + storefront Astro +
defaults + puck-config fields:**
- [ ] **featured-product** — one spotlighted product (image + price + CTA).
- [ ] **collection-list** — a row/grid of category cards (distinct from category-nav pills).
- [ ] **multicolumn / icon-features** — N columns of icon + heading + text (USPs: shipping, COD, etc.).
- [ ] **faq / accordion** — collapsible Q&A (reuse the `.pdp-acc` reveal pattern).
- [ ] **newsletter / lead** — email/WA capture (writes to the existing lead/CRM path, or wa.me).
- [ ] **gallery / image-grid** — a simple image grid (uses the image picker heavily).
- [ ] **video** — embed (self-hosted mp4 or a poster + link; no third-party script per CSP).
- [ ] **spacer / divider** — layout breathing room.
- [ ] **contact / map** — address + hours + WA button (store fields already exist).

**Decide later:** a raw HTML block (Shopify "custom liquid") — powerful but an XSS surface; gate behind
sanitisation before considering.

---

## 6. P3 — Default templates (Category + Product)

- **Category default:** e.g. `hero` (category banner) → `product-grid` (that collection) → `rich-text`.
  This is the "bahan custom" starting point.
- **Product default:** the hand-built PDP already renders when there is no template; a product *template*
  fills the tail slot (see `[handle].astro`: a template REPLACES the "Rekomendasi" tail). Seed a default
  that adds e.g. `image-text` (care/sizing) → `product-grid` (related) → `testimoni`.
- Seed both for the demo store in `seed-templates.ts` alongside the homepage (same UPSERT-safe pattern),
  `isDefault: true`, one per `type`. Confirm `resolveTemplate` picks them and the storefront renders them.

---

## 7. P5 — Builder UX polish (Shopify-like)

- Section **outline/list** with move up/down, duplicate, hide, delete — Puck provides an outline; skin it
  and make add-section a **thumbnailed picker** (SECTION_LABELS + a small preview) instead of a bare list.
- **Field panel grouping** (content / style / advanced) where a section has many fields.
- Lighter **header** (already customised) + a **device toggle** (desktop/mobile preview) if Puck viewport
  supports it (`Viewport` type exists).
- Keep everything on our tokens (`puck-theme.css` already themes Puck).

---

## 8. Files map (where each change lands)

| Concern | File(s) |
|---|---|
| Image/link picker fields | `apps/admin/lib/theme/puck-config.tsx`, new `components/theme/image-picker.tsx`, `link-picker.tsx` |
| Picker data | `apps/admin/lib/actions/media.ts` (have), `lib/data/products.ts`, `lib/data/collections.ts`, maybe `lib/data/pages.ts` |
| New sections | `packages/sections/src/registry.ts` (+types), `apps/storefront/src/components/sections/*`, `apps/admin/components/theme/sections/*` |
| Default templates | `packages/db/src/seed-templates.ts` |
| Builder UX | `apps/admin/app/(admin)/tema/[id]/builder-client.tsx`, `lib/theme/puck-theme.css`, `puck-field-overrides.tsx` |
| Storefront render | `apps/storefront/src/components/sections/SectionRenderer.astro`, `pages/{index,kategori/[handle],produk/[handle]}.astro` |

## 9. Guardrails
- Registry + admin preview + storefront component must stay in lockstep (a new section touches all three
  or the builder shows what the storefront won't render).
- Image field value stays a **plain URL string** — no data migration, old templates keep working.
- Multi-tenant: pickers only ever read the current store's media/products/collections (RLS + explicit
  `storeId`).
- Provider brands stay hidden (ADR 0004); no third-party scripts in storefront sections (CSP).
- Every section verified on the storefront (real browser, 0 console errors, responsive) before "done".
