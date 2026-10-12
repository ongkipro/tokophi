<!-- Moved from the repository root on 2026-09-11: the root PRD.md is the product entrypoint the
     authority table (specs/README.md) names; this file is the landing-site scope it used to hold. -->
# PRD: Tokophi Multi-page Marketing Site

**Status:** Implemented locally, pending product review

**Surface:** `https://tokophi.com`

**Implementation:** `apps/landing`
**Last validated:** 2026-08-06 (Asia/Jakarta)

## Product goal

Tokophi needs a seller-focused public site that explains the product through separate intent-led
pages instead of one long landing page. A prospective Indonesian seller should understand what the
product does, how the workflow operates, which payment and shipping capabilities are available,
and where to inspect a public demo before creating a store.

## Audience and positioning

- Primary audience: Indonesian online sellers.
- Positioning: one operational workspace for catalog, orders, payments, shipping, customers, and
  store activity.
- Tone: clear, operational, trustworthy, and free of unsupported commercial claims.
- Buyer-facing commerce remains on merchant storefronts, not the apex marketing site.

## Canonical routes

| Route | Intent |
|---|---|
| `/` | Sales page: product introduction, workflow, fees, pricing |
| `/fitur/` | Verified product capabilities |
| `/cara-kerja/` | Signup to first order, daily workflow, billing timeline |
| `/pembayaran-pengiriman/` | Payment channels, COD rules, couriers, payout, fees |
| `/demo/` | Privacy-safe public storefront proof |
| `/harga/` | Subscription price, monthly/annual, and who pays which fee |
| `/faq/` | Retired 2026-10-12 (owner: FAQ not needed yet); 301 → `/harga/` |
| `/kontak/` | Operator identity and support channels |
| `/privasi/` | Privacy notice |

Pricing is published since 2026-10-11 (owner request): `/harga/` and the homepage pricing band read
every figure from `@tokophi/lib` (billing, payment-fees, order-finance), so the page cannot drift from
what billing and checkout charge. Visual and UX decisions: `apps/landing/DESIGN.md`.

## Component architecture

```text
Base.astro
└── MarketingLayout.astro
    ├── SiteHeader.astro               native <dialog> mobile menu, small inline script
    ├── route content
    │   ├── home/*.astro               homepage sections (Hero … Closing)
    │   ├── PageIntro.astro            inner-page opening (H1, lede, two actions)
    │   ├── DetailSection.astro        topic + real screen + detail list (/fitur, /pembayaran-pengiriman)
    │   ├── Pricing.astro, FeeTable.astro
    │   └── Screen.astro               real screenshots (lib/screens.ts inventory)
    ├── SiteFooter.astro
```

Astro owns routes, metadata, and static content; there is no React and no hydrated island (removed
2026-10-12). Figures come from `src/lib/offer.ts`, which imports the constants billing and checkout
enforce. Icons are inline Lucide SVG (`src/lib/icons.ts`).

## Requirements

### PR-LP-09: Multi-page information architecture

The apex shall use distinct canonical pages with unique intent, metadata, one `h1`, maintained
internal links, and sitemap coverage. The homepage shall summarize choices rather than duplicate
all long-form content.

### PR-LP-10: Shared adaptive navigation

Every public page shall expose the same maintained route set, seller login, and create-store action.
Desktop navigation shall remain static Astro. Mobile navigation shall provide accessible focus
management, active state, keyboard operation, and Escape dismissal.

### PR-LP-11: Restrained motion

Motion shall be CSS only (scroll-driven `animation-timeline: view()` for screenshots below the fold,
keyframes for the checkout state sequence), animate only transform and opacity, never animate above
the fold (LCP), never replace native scrolling, and leave all content visible under reduced motion
or in browsers without scroll-driven animation.

Superseded 2026-10-12 (owner: "jika berat sempurnakan… fokus SEO friendly dan tidak berat"): GSAP +
ScrollTrigger (115 KB JS, 45 KB gzip) and the hero entrance were removed; Lighthouse mobile home
went from 92 to 98 Performance, TBT 0 ms, CLS 0. Lenis was considered and rejected
(`apps/landing/DESIGN.md` "Motion concept").

### PR-LP-12: Requested implementation stack

The site shall use Astro, TypeScript, Tailwind CSS and inline Lucide SVG, with no React, no hydrated
island and no animation library (PR-LP-11).

Superseded 2026-10-12 (owner: "jalankan sesuai rekomendasimu"): the earlier stack used shadcn
primitives from `@tokophi/ui` and a hydrated React mobile menu. A native `<dialog>` does the menu with
less JavaScript (about 400 KB → 116 KB), so React, `@astrojs/react`, `lucide-react` and `@tokophi/ui`
were removed from the landing.

## Content constraints

- Visible marketing copy uses Bahasa Indonesia.
- Do not publish unaccepted fees, payout timing, settlement behavior, provider availability,
  service coverage, testimonials, statistics, or customer claims.
- Product imagery must come from privacy-reviewed demo data and include explicit dimensions and
  meaningful alt text.
- Use `Dashboard Seller` for the merchant application surface.
- Existing build-time login, signup, demo, identity, and contact fallbacks remain authoritative.

## Quality requirements

- No horizontal overflow at 320, 390, 768, 1024, 1280, or 1440 CSS pixels.
- Exactly one `h1` and no duplicate ID per canonical page.
- Complete keyboard focus behavior, dark scheme, and reduced-motion support.
- No empty link target or broken internal route.
- Unique title, description, canonical URL, and sitemap entry per canonical route.
- `npm run check:landing` and `npm run build -w @tokophi/landing` must pass.

## Known remaining evidence gap

The public storefront demo capture is integrated and privacy-reviewed. A current, seeded,
privacy-reviewed Dashboard Seller screenshot is still required before replacing the honest abstract
hero artwork with seller-product imagery.
