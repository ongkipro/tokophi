# Store Builder / Tema and Landing HTML

> Moved **verbatim** from `AGENTS.md` on 2026-10-28 (Claude Code warns when `AGENTS.md` exceeds 150k chars, and it is
> loaded in full into every session). `AGENTS.md` keeps a short digest of the rules plus a pointer here; this file keeps
> the reasoning and the incident history. Words like "above"/"below"/"the next section" refer to the old single-file
> layout — follow the named file or section instead. **If this file and the code disagree, the code wins — fix this file.**

## Store Builder / Tema — three page types, three different jobs


`page_templates.type` is `homepage | category | product` and they are **not interchangeable**:

| Type | What the template IS | Rendered by |
|---|---|---|
| `homepage` | the whole page | `index.astro` |
| `category` | the **body** under the category's own header | `kategori/[handle].astro` |
| `product` | the **PDP tail** only (gallery, buy box, reviews, description untouched) | `produk/[handle].astro` |

- ⚠️ **`CategoryHero` is ALWAYS rendered — a template never replaces it.** It used to: building a
  category template cost the page its `<h1>`, its breadcrumb and its cover, while the BreadcrumbList
  JSON-LD kept publishing a trail nobody could see. (`produk/index.astro` already worked correctly;
  the two sibling listing routes had simply diverged.)
- **`product-listing` ("Daftar Produk") is the catalogue; `product-grid` ("Grid Produk") is a
  merchandising row.** Daftar Produk wraps the same `ProductListing.astro` the hand-built page uses
  — server-side sort, 12-per-page pagination, one empty state. Grid Produk is a flat slice capped at
  `limit` with neither. The builder used to offer only Grid Produk on a category template, so its
  own hint ("tambahkan Grid Produk") steered merchants into **silently truncating their catalogue
  and losing sort + paging**.
- **The palette is per type** — `SECTIONS_BY_TEMPLATE_TYPE` in `@tokophi/sections`, applied by
  `puckConfigFor(type)`. No `hero` on a category (CategoryHero owns the `<h1>`; a second one is the
  a11y defect the homepage carousel already has) and none on a product (the product name is the
  `<h1>`); no navigation furniture under a buy box.
- **Narrow the PALETTE, never the RENDERER.** `SectionRenderer` still switches on every type, so a
  template saved earlier holding a section no longer offered for its type keeps rendering. Removing
  it from the sidebar stops merchants adding more; it must never silently delete published work.
- ⚠️ **The renderer's `default:` arm is a GUARD, not a branch to tidy away.** 14 `case`s and no
  fallthrough meant a type added to `SectionConfigMap` and forgotten **compiled and rendered nothing**
  — part of a merchant's published page gone, no error, no failed build. The admin half never had this
  problem (`Config<SectionConfigMap>` in `puck-config.tsx` is an exhaustive mapped type, so the
  BUILDER refused the new section while the RENDERER stayed silent). `const _exhaustive: never = item`
  closes it. **`astro check` is the only thing that compiles that file, and it is WIRED NOW** —
  `npm test` is `vitest run && npm run check:storefront` (+14 s). For a long time nothing ran it (the
  storefront's build is a bare `astro build`, transpile-only), so that guard was decoration.
  ⚠️ **Both halves are load-bearing and they catch different things.** `astro check` catches a wrong
  **prop**; `section-renderer-exhaustive.test.ts` catches a missing or misrouted **arm** — and it reads
  the file's CODE, not its text (see the rule below): commenting out `case "lookbook":` left the text
  in place and kept all four tests green while the renderer dropped that section on a live storefront.
  The same was true of the `_exhaustive: never` assertion itself.
- A type that genuinely is unknown at runtime (an older saved template, a rolled-back deploy) gets a
  `console.warn` on the server — this is SSR, so it lands in the container log — plus a visible panel
  **in DEV only**. Not in production on purpose: a shopper must not be shown our internal error on a
  merchant's live shop. Silence toward the shopper, never silence toward us.

## Landing HTML (`/lp/<slug>`) — raw markup, OWNER-ONLY


- ⚠️ **`set:html` EXECUTES.** The pasted HTML is emitted into the SSR response **body**, so the
  browser's HTML **parser** handles it — not `innerHTML`. A `<script>` tag in it **runs**, on the
  shop's own origin, on the page carrying the COD order form (name, WhatsApp, full address). There is
  no sanitizer on this path and no CSP on the storefront. The admin used to tell the merchant the
  opposite ("Tag &lt;script&gt; tidak dijalankan (keamanan)"), and the storefront comment it came from
  said the same. Both now say the truth.
- **Changing that HTML needs `landing:html` — owner only.** Everything ELSE on the screen (title,
  slug, product, countdown, funnel fields) still needs only `content:write`: the escalation is on the
  executable markup, not on the feature, so staff keep managing landings. Enforced in
  `actions/landing.ts` **only when the html differs from the stored row**, and gated in the editor so
  a staff user sees why before typing rather than after pressing Simpan.
- ⚠️ **Do NOT "fix" this with a regex sanitizer.** `<script>` is the obvious vector; `onerror=`,
  `javascript:` in an `href`, `<iframe srcdoc>` and SVG event handlers are not. A partial strip would
  restore exactly the false confidence that caption was already providing. A real sanitizer (or a CSP)
  is a separate, deliberate piece of work.
- `admin` is derived by SUBTRACTION (`ALL_CAPABILITIES.filter(...)`), so a new owner-only capability
  must be excluded there **explicitly** or it leaks to admin by default. `apps/admin/lib/rbac-landing.test.ts`
  pins that one capability; **`apps/admin/lib/rbac-census.test.ts` pins the CLASS** — a
  `Record<Capability, "owner-only" | "admin-too">` naming who is meant to hold each one, so a new
  capability fails `tsc` (the mapped type is missing a key) *and* `vitest` until someone classifies it.
  ⚠️ **`admin` was deliberately NOT converted to an allow-list.** That swaps a silent grant for a
  silent REMOVAL, which is worse to diagnose: `useCan` hides the control, so the admin gets no error —
  the button is simply not there. The census pins both directions instead; editing an entry in it is
  how you record a change of mind, and it grants/revokes for every store's Admin user in production.
