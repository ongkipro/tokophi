# Tasks: Tokophi Multi-page Marketing Site

**Source:** `PRD.md`

**Worktree:** `~/Projects/tokophi-landing-v2`

**Branch:** `feat/landing-v2`

## Safety rules

- Work only in the dedicated landing worktree.
- Do not commit, push, merge, or deploy without explicit approval.
- Do not publish unapproved fee or settlement claims.
- Preserve unrelated changes from other devices and collaborators.

## Architecture and foundation

- [x] **T-MP-01: Specify the route and component architecture**
  - **Requirement:** PR-LP-09
  - **Result:** Shared Astro layout, static route ownership, one React island, shadcn server render,
    centralized motion, content boundaries, and validation gates are documented in `PRD.md`.

- [x] **T-MP-02: Add Astro React, shadcn, Lucide, and GSAP foundations**
  - **Requirement:** PR-LP-12
  - **Result:** Direct dependencies resolve, Astro React is configured, and shadcn semantic tokens
    map to the existing Tokophi light/dark brand tokens.

- [x] **T-MP-03: Build the shared adaptive marketing shell**
  - **Requirement:** PR-LP-10
  - **Result:** Shared header, active desktop navigation, accessible shadcn mobile Sheet, maintained
    footer routes, login, and signup actions are implemented.

## Pages and content

- [x] **T-MP-04: Refactor the homepage into a concise route gateway**
  - **Requirement:** PR-LP-09
  - **Result:** The homepage now introduces the product, routes visitors by intent, presents demo
    proof, and closes with one create-store action.

- [x] **T-MP-05: Build the canonical features page**
  - **Requirement:** PR-LP-12
  - **Result:** Six verified capability groups use shadcn cards and explicit Lucide imports without
    an additional hydrated island.

- [x] **T-MP-06: Build the workflow page**
  - **Requirement:** PR-LP-09
  - **Result:** The page explains setup, catalog, incoming orders, fulfillment, and shipping without
    unsupported automation language.

- [x] **T-MP-07: Build the payment and shipping page**
  - **Requirement:** PR-LP-09
  - **Result:** QRIS, bank transfer, COD, and shipping are explained while fee, payout, and
    settlement details remain explicitly gated by Issue `#180`.

- [x] **T-MP-08: Build dedicated demo and FAQ pages**
  - **Requirement:** PR-LP-09
  - **Result:** Both routes have unique metadata, verified copy, and privacy-safe demo imagery.

## Motion, SEO, and quality

- [x] **T-MP-09: Implement centralized GSAP motion**
  - **Requirement:** PR-LP-11
  - **Result:** Hero entrance, section reveal, grouped reveal, and desktop-only demo depth use
    transform/opacity, `matchMedia`, ScrollTrigger, and reduced-motion guards.

- [x] **T-MP-10: Complete metadata, sitemap, and internal linking**
  - **Requirement:** PR-LP-09
  - **Result:** All eight canonical routes have unique metadata, working internal links, and sitemap
    entries. Visible marketing copy contains no separator-style em/en dash.

- [x] **T-MP-11: Validate routes, devices, accessibility, and hydration**
  - **Requirement:** PR-LP-10
  - **Evidence:** Astro check/build and `git diff --check` pass. Browser automation reports no route,
    overflow, heading, duplicate-ID, internal-link, console, dark-mode, or reduced-motion failure at
    320, 390, 768, 1024, 1280, and 1440 CSS pixels. The mobile dialog traps focus and closes with
    Escape. `/fitur/` contains one hydrated island, `MobileNav`.

## Remaining product proof

- [ ] **T-MP-12: Add a current privacy-safe Dashboard Seller capture**
  - **Requirement:** PR-LP-09
  - **Blocked by:** An approved seeded-demo capture source.
  - **Done when:** The image contains no production personal data, has explicit dimensions and alt
    text, and replaces the abstract hero artwork after browser review.

## Deferred

- [ ] **T-MP-13: Publish approved pricing and fee details**
  - **Requirement:** PR-LP-09
  - **Blocked by:** Accepted and implemented order-finance policy in GitHub Issue `#180`.

- [ ] **T-MP-14: Add approved analytics events**
  - **Requirement:** PR-LP-09
  - **Blocked by:** Product-owner provider and privacy approval.
