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
| `/` | Product introduction and route gateway |
| `/fitur/` | Verified product capabilities |
| `/cara-kerja/` | Seller workflow from setup to fulfillment |
| `/pembayaran-pengiriman/` | Payment and domestic-shipping operating model |
| `/demo/` | Privacy-safe public storefront proof |
| `/faq/` | Verified operational answers |
| `/kontak/` | Operator identity and support channels |
| `/privasi/` | Privacy notice |

Pricing is intentionally absent until the order-finance policy tracked in GitHub Issue `#180` is
accepted and implemented.

## Component architecture

```text
Base.astro
└── MarketingLayout.astro
    ├── SiteHeader.astro
    │   └── MobileNav.tsx              React + shadcn Sheet, client:load
    ├── route-owned Astro content
    │   ├── PageHero.astro
    │   ├── FeatureIconGrid.tsx        shadcn Card + Lucide, server-rendered
    │   ├── RouteGateway.astro
    │   ├── StoreDemo.astro
    │   └── FinalCta.astro
    ├── SiteFooter.astro
    └── MotionLayer.astro              GSAP + ScrollTrigger
```

Astro owns routes, metadata, and static content. React is hydrated only where the mobile modal state
and focus management require it. Tailwind v4 scans only the reused `@tokophi/ui` primitives and maps
their semantic shadcn tokens onto the existing Tokophi design tokens.

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

GSAP shall provide hierarchy and scroll reveal without scroll-jacking. Motion shall animate only
transform and opacity, use one centralized registration point, disable depth effects on smaller
screens, and leave all content visible under reduced-motion or JavaScript failure.

### PR-LP-12: Requested implementation stack

The site shall use Astro, TypeScript, Tailwind CSS, shadcn primitives from the existing
`@tokophi/ui` package, explicit Lucide icon imports, and GSAP. React hydration is limited to the
mobile navigation; feature cards render on the server.

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
