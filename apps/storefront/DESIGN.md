# DESIGN.md — TokoΦ storefront (all tenants)

## Direction
Picked-by: owner 2026-11-05 (direction C of 3 — "Horizon + kepercayaan lokal")
Constraint from the same pick: stays in sync with the Seller **Tema** editor (Store Builder).

Surface/job: a cold, mobile, ad-arrived Indonesian shopper decides "is this shop real, is this the
price, can I pay COD" and buys. One platform default design; each store tints it with its own dials.

References: `design/refs/theme-horizon-demo.myshopify.com*` (geometry: short hero, product grid in
the first scroll, full-bleed swipe gallery, sticky buy bar, flat cards) and
`design/refs/theme-dawn-demo.myshopify.com*` (calm type scale, generous whitespace, quiet footer).
Baseline replaced: `design/refs/batiknusantara.tokophi.id*` (9 000 px mobile home, products after
~2.5 screens, floating chat over content, busy cards, eyebrow on every heading).

Feel: bersih, cepat, bisa dipercaya. Photo style: product on plain light ground, 4:5 by default
(the store's `cardAspect` dial wins). Motion: subtle.

Won't do: floating bottom-corner bubbles · an eyebrow/kicker over section headings · more than one
filled primary button per viewport.

### Sections (platform default homepage, in order)
1. Announcement bar (above the sticky header, scrolls away — owner 2026-11-05) + header — one line
   "COD · Ongkir otomatis · Kirim se-Indonesia"
   built only from facts the store really has (COD from `lib/cod`, never a promise it does not offer).
2. Hero — one slide default, fills the rest of the first screen: `100svh − --site-chrome` (owner
   2026-11-05, overriding the earlier 60 % rule). Header 64 px (phone) / 72 px (md+), no rules.
3. Kategori — round/aspect tiles, horizontal scroll at 360.
4. Terlaris — product grid, 2 cols at 360, 4 at 1440.
5. Produk baru — product grid.
6. Ulasan — verified reviews + rating summary (trust).
Footer — store info, menus, one contact block. Merchant-built templates keep THEIR section list;
this list is the default for stores without one and the seed for new stores.

### Composition contract
C1: (360) announcement bar ≤ 32 px above a sticky header ≤ 56 px; first product card top edge visible within 2
   viewports on the default home, within 1 viewport on `/produk` and `/kategori/*`.
C2: (listing, 360) the page header is title + count + sort/filter on one row; no info-chip block and
   no category carousel above the grid.
C3: (PDP, 360) gallery full-bleed (no side gutter, no radius), swipe with dots; title, rating ★ +
   "N terjual", price, compare-at, variants, then buy box. Thumbnail rail only from 768 up (or when the
   store's `productGalleryLayout` asks for it).
C4: (PDP, 360) a sticky bottom bar after the buy box scrolls away: price + **Beli Sekarang** (the one
   filled primary) + an outline cart icon button. Chat/WA lives in this bar, not in a floating bubble.
C5: (card) image, name ≤ 2 lines, price, compare-at struck, one discount badge. No category eyebrow,
   no "terjual" on cards in grids (it moves to the PDP).
C6: (1440) content max 1280 px; PDP gallery 7/12 left, sticky buy column 5/12 right.
C7: (all) every section renders the same in the Tema editor canvas and on the storefront (see Sync).

### Sync with the Seller Tema editor (non-negotiable)
- `packages/sections/src/registry.ts` stays the one config shape. Restyle only; a config field is
  added/renamed only with both renderers and a default, so saved templates keep rendering.
- Every `apps/storefront/src/components/sections/<T>.astro` change ships with the matching
  `apps/admin/components/theme/sections/<T>.tsx` change in the same commit (same markup classes,
  same tokens) so the editor preview equals the shop.
- Dials keep working on both sides: `brandColor` (11-shade scale), `theme.font` (5 pairings),
  `theme.tone` (3), `cardAspect`, `galleryAspect`, `productGalleryLayout`.
- Chat widget (CHAT_SPEC §5a) keeps its behaviour; only its LAUNCHER moves (header icon + PDP bar)
  — owner 2026-11-05.
- **Checkout is ON HOLD** (`checkout.astro`, `checkout/sukses`, `CheckoutLayout`) — owner 2026-11-05:
  not to be changed until the owner decides. Only `global.css` is shared, and it must stay inert there.
- Existing templates are RESTYLED, never rewritten. The 6-section default becomes a preset: used
  for new stores and offered in Tema as "Pakai susunan baru", applied only by the merchant — owner
  2026-11-05.

## Tokens
Existing token names are kept (`--color-brand-*`, `--color-ink`, `--color-muted`, `--color-line`,
`--color-cream`, `--font-display`, `--font-sans`) because `generateTenantThemeVariables` writes them.

### Colour
Minimalist modern, black / white / grey (owner 2026-11-05: "jangan pink, merah juga jangan").
No brand chosen → `NEUTRAL_BRAND_SHADES` (`packages/lib/src/colors.ts`, mirrored in `global.css`):
primary `brand-600` = #18181b (black button), hover `brand-700`. A merchant brand colour colours
BUTTONS and links only. Surface tints are never brand-derived: `mist` #f4f4f5 (image frames,
placeholders, hovers, chips) and `mist-strong` #e4e4e7. Discount/promo badges, stars and review bars
are `ink`. Red is kept only for errors (`text-red-700`). ONE deliberate colour: the review "Terverifikasi" seal
(#1D9BF0, social-media verified blue, white check; the word stays body ink) — owner 2026-11-05. Page `cream` #fafafa, text `ink`, `muted`,
rules `line`. Screening: `scratchpad hue scan` found 0 saturated red/pink elements on 9 pages.

### Type
`--font-sans` Inter for UI + body; `--font-display` = the store's pairing (Inter by default).
Scale (px, 360 → 1440): body 16 · small 14 · caption 13 (floor 12) · card title 15 · H3 18→20 ·
H2 22→28 · H1 26→36. Display letter-spacing ≥ −0.02em. Prices `tabular-nums`, weight 600.

### Radius
Buttons/inputs 8 px · cards/images 4 px (0 for full-bleed gallery) · chips full.

### Spacing
Base 4. Gutter 16 px (360) / 24 (768) / 32 (1440). Section gap 40 px (360) / 64 (1440).
Touch targets ≥ 44 px on buy/cart/variant controls, ≥ 24 px everywhere.

### Motion
150–250 ms, `ease-out`, transform/opacity only, no `transition: all`. Hero autoplay pauses on hover/
focus and is off under `prefers-reduced-motion`.

## Allow
allow: hero-height — owner 2026-11-05: the hero fills the first screen on every device by design.
