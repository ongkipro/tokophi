# Panduan TokoΦ (`apps/docs`) — design record

Owner of visual and UX decisions for the Seller help center. Product scope, content rules and the
fact base live in [`specs/docs/PANDUAN_SPEC.md`](../../specs/docs/PANDUAN_SPEC.md) (Task 8.37);
this file was split out of its §6 on 2026-10-12 so the `design-taste` gate has one design owner.

**Owner rulings recorded here (2026-10-12):** own UI, not the landing's; search not in the header —
a large Shopify-Help-style field on the home page and the sidebar elsewhere; header = "Toko" + Φ as
the logo glyph with no box, nav, Daftar gratis / Masuk; theme as one icon (auto by default), no
dropdown; minimal link states ("biar gak card bold"); topic groups with icons and no section title,
centred; a hero with a background ornament; footer and header refined with the dotfiles rules.


## Reader, job, sequence

- **Reader:** the same person as the landing's (Indonesian seller, mostly on a phone), but *after*
  signing up, usually with the Dashboard Seller open in another tab, mid-task.
- **Job:** find the one article for the screen they are stuck on, follow it step by step, get back to
  work. Secondary: a new Seller walks the 7-step tutorial once, start to finish.
- **Sequence:** home (search, or the 7 steps, or a reference page) → article (lead → prerequisites →
  steps → trouble) → next step via pagination. No marketing CTA anywhere: the reader already bought.

## Reference evidence

Captured 2026-10-12 with `design-taste/scripts/ui-ref.mjs` at 390 and 1440 px into
the git-ignored refs folder under `design/` (local research material), screenshots opened and
inspected.

| Reference | Role | Observed | Transfer / reject |
|---|---|---|---|
| `design/refs/panduan-shopify-help-article/1440.png`, `design/refs/panduan-shopify-help-article/390.png` (help.shopify.com/id, "Menambahkan dan memperbarui produk") | **Target composition — article** | One centred reading column (~760 px at 1440), breadcrumb row above the H1, plain sans body, inline links underlined, no sidebar visible at first paint; at 390 the same column with 20 px gutters, H1 wraps to two lines | Transfer: single reading column, breadcrumb above H1, body links underlined, nothing competing with the steps. Reject: embedded video (we have none and will not fabricate one), "Tanyakan tentang artikel ini" AI box, floating chat button |
| `design/refs/panduan-shopify-help-home/1440.png` (help.shopify.com/id/manual) | Directional — hub | Centred question headline + full-width search, a promo banner, then "Telusuri berdasarkan topik": three text columns of plain links under a bold topic heading | Transfer (owner ruling 2026-10-12): the **centred question + one full-width search** as the home page's first job, and topic groups as **plain link lists under a heading**, not cards. Reject: promo banner, AI chat box |
| `design/refs/panduan-shopee-edu/1440.png` (seller.shopee.co.id/edu, Pusat Edukasi Penjual) | Directional — local market | Banner carousel; three journey cards "Mulai berjualan / Kembangkan toko / Sukses di Shopee"; course cards with level + duration; "Artikel Bantuan" = 11 topics, each an icon + title + one-line description in a 3-column grid | Transfer: the **journey framing** (start → grow) local sellers already know, and topic = title + one-line description. Reject: carousels, illustrations, level/duration badges, orange promo density |
| `design/refs/panduan-stripe-docs-start/1440.png` (docs.stripe.com/get-started) | Directional — navigation | Persistent left sidebar grouped by stage ("Start building", "Common use cases"), content column with H1 + subtitle, "Start building" link cards | Transfer: on wide screens, a **left chapter rail** so the reader sees where the article sits in the sequence. Reject: tracked-uppercase group labels, equal link-card grid |
| help.mayar.id | Blocked | `DNS_PROBE_FINISHED_NXDOMAIN` — no evidence obtained | Not used for any decision |

## Direction

**"The panel's manual."** A calm reference site whose identity is the Dashboard Seller itself: the
accent is the panel's indigo (`#4338ca` light / `#818cf8` dark), so the toggles and buttons in the
screenshots and the links on the page read as one product; the logo is the Φ mark on that indigo.
Type is the system UI stack — legible Bahasa Indonesia at small sizes, no web-font download. It does
**not** inherit the landing's serif display or tokens (owner ruling). Light and dark both supported
(Starlight's theme switcher, defaulting to the OS).

## Composition contract

- **C1 — Header** (override `SiteHeader.astro`; owner ruling 2026-10-12: *"search tidak di header … jangan hanya logo phi namun tokophi (phinya logo)"*): clean wordmark "Toko" + Φ as the logo glyph (accent colour, serif, no box or background — owner 2026-10-12), a divider, "Panduan"; nav Mulai · Referensi · FAQ with an underline for the current section; right: a **single theme icon button** (moon/sun; follows the device by default, a click switches, switching back to the device's preference clears the stored choice — `ThemeToggle.astro`, replaces Starlight's dropdown, which is also removed from the mobile menu), **Daftar gratis** (outline), **Masuk** (solid) to `app.tokophi.com`. Below 50rem: wordmark, theme icon, Masuk and Starlight's menu button. **No search in the header.**
- **C2 — Home** (Shopify Help transfer): centred question "Bantuan apa yang Anda perlukan?", one sentence, one large search field (full hero width, label visible on phones), "Sering dicari" links; then "Telusuri berdasarkan topik" (`TopicGroups.astro`): a 2-column grid (1 column on phones) of one group per chapter — six since phase 2 (Mulai, Produk, Tampilan toko, Pesanan, Uang, Tim), each = Lucide icon (list-checks, package, palette, truck, wallet, users) + linked heading + one-line description, a hairline, then the pages as a list with a caret marker. No cards, no fills.
- **C2b — Search on article pages** sits at the top of the sidebar (and so at the top of the mobile menu drawer). One Search instance per page; Ctrl/⌘ K opens it everywhere. UI strings and Pagefind's result text are translated (`src/content/i18n/id.json`).
- **C2c — Link states are minimal** (owner: *"active hover link … biar gak card bold"*): the current sidebar item is accent text + a 2px left rule, weight 500, no filled block; hover only changes text colour; TOC current item is colour only. Asides are a 35% tint + 3px rule instead of a solid colour block.
- **C3 — Steps are the spine.** Every procedure is a `<Steps>` list (numbered circles + rail).
- **C4 — Callouts** are Starlight asides with an Indonesian title; max three per page.
- **C5 — Screenshots** sit in a 1px frame with a 12px radius and one soft shadow (white panel on a
  white page needs an edge); phone captures are capped at 20rem and centred; every one has a caption.
- **C6 — Glossary** is a dictionary: one `##` per letter (so the TOC is an A–Z index) and a `<dl>`
  per letter with anchored terms that other pages link to.
- **Do not substitute:** illustrations or stock art; a marketing hero image; tracked uppercase
  eyebrows; emoji as icons; a chat widget.

## States

- Static site: no loading/error states of our own; Starlight's 404 page links back home. Search
  shows Pagefind's own empty state.
- A screenshot that has not been captured yet is **omitted**, never replaced with a drawn mock
  (`design-taste` §4.5). The article must still be followable from the text alone.

## SEO

- `<title>` = `<title> | Panduan TokoΦ` (Starlight); meta description from frontmatter. Canonical
  URLs and `sitemap-index.xml` turn on when `site` is set in `astro.config.mjs` — which needs the
  hostname decision (§9).
- JSON-LD: `HowTo` is **not** used (Google no longer shows HowTo rich results); `BreadcrumbList` on
  articles only.
- `noindex` nothing — these pages are a legitimate acquisition surface ("cara buka toko online COD").

## Owner-rule compliance (dotfiles `preferences.md`)

| Rule | How it is met | Check |
|---|---|---|
| Icons: inline Lucide SVG, functional only | `src/components/lucide-icons.ts` generated from `lucide-react` 1.29.0 nodes; `Lucide.astro`; icons: list-checks, package, wallet, book-open, moon, sun, chevron-right, search, file-text | source |
| Section transitions: whitespace / background shift, not rules | Hero and footer are tinted full-bleed bands; no `border-top` on the footer | render |
| Title 55–70 chars, `{page} - {brand}`, no `\|`/`—`; description 120–155 ending "."; meta author + publisher | `titleDelimiter: "-"`, `seoTitle` per page, `src/routeData.ts`, `head` meta | `npm run check -w @tokophi/docs` (`scripts/check-seo.mjs`, mutation-proved) |
| Images WebP, ALT 10–125 chars | `Shot.astro` + `astro:assets` WebP | same check |
| No Sparkles, invented meters, contact-CTA spam | none present | source |

## Hero ornament

The Φ itself — a circle crossed by a vertical stroke, with an inner ellipse and a dotted outer
ring — drawn as 1px hairlines in the accent at 20% (28% dark), behind the heading. A radial mask
leaves a hole where the heading and search sit, so the lines frame the text and never cross it,
and fades out before the band's edge. The band is a background shift (`gray-7` → page) with a soft
accent glow at the top. `aria-hidden`, no motion, `pointer-events: none`. Rationale: the only
ornament that is specific to this brand is its own mark; a generic dot grid or gradient wash is
the template look the critique list warns about.

## Render critique

Author: claude/claude-opus-5-5

Fresh renders, Chrome via Playwright, light scheme unless named, captured after the last source
edit on 2026-10-12: `design/renders/home-390.png`, `design/renders/home-1440.png`,
`design/renders/home-dark-1440.png`, `design/renders/article-390.png`,
`design/renders/article-1440.png`, `design/renders/kamus-390.png`, `design/renders/kamus-1440.png`,
`design/renders/search-dark-1440.png`, `design/renders/chapter-article-390.png`,
`design/renders/chapter-article-1440.png` (re-captured after the phase-2 chapters, 2026-10-12).

- **Header** (all): wordmark reads "TokoΦ" with Φ in the accent and no box; divider + "Panduan";
  nav underline marks the current section; theme icon, outline "Daftar gratis", solid "Masuk". At
  390 only wordmark, theme icon, Masuk and the menu button — nothing truncates. Accepted.
- **Hero** (home-1440, home-390, home-dark-1440): first pass had the Φ lines crossing the heading
  and tagline and the outer ring cut off under "Sering dicari" → fixed with the centre-hole mask and
  a smaller ornament; now the lines sit around the text in both themes. Search field 704px at 1440
  (was capped at 22rem by Starlight → fixed), full width at 390 with its label visible.
- **Topic groups, phase 2** (home-1440, home-390): one group per chapter — Mulai, Produk, Tampilan
  toko, Pesanan, Uang, Tim — as a 2×3 grid on the same 50rem axis (an even count, so no orphan),
  Lucide palette/truck/users added from the installed package. One column at 390; the page is
  longer but every group is a scan of three links. Referensi and FAQ stay in the header nav.
- **Sidebar, phase 2** (chapter-article-1440): six chapters made the rail long, so chapter groups are
  collapsed; the current page's group and "Mulai di sini" open. Current page keeps the accent rule.
- **Topic groups** (home, phase 1): 2×2, centred on the search's axis (max 50rem), icon + heading +
  one-line description, hairline, caret list. Earlier passes had a 3+1 orphan, an off-baseline first
  column and a duplicated "Masih butuh bantuan?" → all fixed. One column at 390.
- **Article** (article-1440, article-390): sidebar search on top; current page = accent text + 2px
  rule (no filled block); steps as numbered rail; asides as a 35% tint + 3px rule (were solid
  blocks); screenshots framed, captioned, and now open full size (wide captures are small at 390).
  Prev/next were heavy shadowed cards with 2xl titles → now hairline links with base-size titles.
- **Glossary** (kamus-1440, kamus-390): one `##` per letter drives an A–Z TOC; terms are `h3` so
  search returns the term ("AWB", "Resi") instead of the letter.
- **Search dialog** (search-dark-1440): borderless input with a hairline, Indonesian strings, results
  as plain rows with accent matches and a tint+rule focus state; a section row out-sized its page row
  (1.06rem vs 1rem) → fixed to 0.94rem. Empty state lists "Sering dicari" and "Mulai dari" and an Esc hint.
- **Footer** (all): tinted band, brand line + three link columns (two columns at 390). It used to stop
  51px short of the page end (Starlight's 24px panel + 27px main padding, measured) → removed, footer
  bottom = document height on both page types.
- **Measured, every page type, 390 and 1440:** horizontal overflow 0px (an earlier `-100vw` footer band
  made article pages scroll 1064px sideways → contained); exactly one `<h1>`; 0 console/page errors.
- **Remaining trade-offs:** wide panel screenshots stay small on phones (mitigated by tap-to-open);
  articles 2 and 3 have no screenshots yet (needs a logged-in demo-store session — content, not layout).

### Review round 1 (codex, REVISE) — response

Fixed, then re-rendered (same render paths as above, recaptured after these edits):
- **Breadcrumb above the H1** on every article (`PageTitleWithCrumb.astro`, chapter taken from
  Starlight's sidebar data) — chapter context no longer depends on the hidden sidebar on phones.
- **"Mulai di sini" promised seven steps but listed four** → a fifth link "Lihat ketujuh langkah".
- **"Panduan resmi"** in the footer → "Panduan Dashboard Seller dari tim TokoΦ" (says who wrote it,
  claims nothing else).
- **Small screenshots on phones** → every caption ends "Ketuk atau klik gambar untuk memperbesar."
  and the image links to its full-size original.
- **Gratis ongkir** was a paragraph → a `<Steps>` list.
- **"Bantuan" was bold text** → links to `app.tokophi.com/bantuan` wherever it is the next action.
- **Glossary**: the intro pointed at a side list that does not exist on phones → now names "Di halaman
  ini"; R reordered to Rekening penarikan → Resi → Retur.
- **Search repeated the page title as its first section** → rows linking to `#_top` are hidden
  (measured: the `#_top` row is `display:none`, "Langkah" is next).

Not changed, with evidence:
- **"Store Builder … menu Tema" vs a project rule "No Themes menu"**: the Seller sidebar does have
  **Tema** (`apps/admin/lib/nav.ts:121`, group "Toko Online"). The product non-goal is "no Themes
  *marketplace*" (`PRD.md`); the "No Themes menu" phrase in `AGENTS.md` is stale wording, filed in
  `specs/docs/PANDUAN_SPEC.md` §11. The glossary describes the real label.


### Review round 2 (codex, REVISE) — response

- **No menu button on the home page at 390px** (Starlight only renders its menu toggle where there is a
  sidebar; the home page has none) → `SiteHeader.astro` adds a native `<details>` menu (Lucide `menu`
  icon, no JavaScript) shown only below 50rem on pages without a sidebar: Mulai, Referensi, FAQ,
  Daftar gratis. Driven in Chrome: visible and opens at 390 on `/`; hidden on `/mulai/` (Starlight's
  toggle is there) and at 1440; overflow 0. Renders recaptured.

### Review round 4 (codex, REVISE; phase-2 chapters) — response

- **Cancelling an order was a paragraph with the warning after the action** → `pesanan/tab-dan-status`
  "Membatalkan pesanan" is now the caution first, then a `<Steps>` list (cancel the courier first,
  then **⋯ → Batalkan**, then what happens). Same fix pattern as round 1's "Gratis ongkir".
- **Glossary intro names "Cari panduan", which sits in the drawer on phones** → "(di ponsel, buka
  menu ☰ dulu)".
- **C2 still said four groups** → C2 rewritten for one group per chapter (six) with the Lucide icons.
Renders recaptured after these edits.
