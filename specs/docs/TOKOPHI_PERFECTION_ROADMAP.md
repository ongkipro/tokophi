# TokoΦ Master Perfection Roadmap — UI/UX, Theme, Frontend & Backend

**Author:** Senior Full-Stack Master Engineering Team
**Target Platform:** TokoΦ (Tokophi) Indonesia Commerce SaaS System
**Audit Reference:** Domain Audit Batches 1–6 (`specs/docs/AUDIT_*.md`)
**Date:** 2026-08-15
**Status:** Approved Architectural Blueprint

---

## 1. Vision & Perfection Strategy

TokoΦ is engineered as the premier Shopify-style commerce SaaS tailored for Indonesian merchants, direct-response sellers, and enterprise brand owners. This perfection roadmap synthesizes frontend presentation, UI/UX interaction standards, theme customization engines, backend data pipelines, and dotfiles-aligned system governance into a single executable blueprint.

---

## 2. UI/UX & Storefront Theme Perfection

### 2.1 Direct-Response & Commerce UX Principles
- **Single-Page Conversion Velocity:**
  - Standardize 1-click checkout option with instant subdistrict (kecamatan) shipping calculator.
  - Floating sticky buy bar on mobile devices with live stock counter hint ("Sisa 3 unit").
- **Indonesian Payment & Logistics UX Native Patterns:**
  - Prominent COD badge with maximum order threshold indicators.
  - Instant QRIS image display with countdown timer for payment settlement.
  - Automated WhatsApp order notification checkbox pre-checked at checkout.

### 2.2 Dynamic Tenant Theme System (`@tokophi/theme-engine`)
- **Theme Architecture:**
  - Tokenized design system powered by Tailwind CSS v4 CSS variables (`--color-primary`, `--color-accent`, `--radius-btn`, `--font-heading`).
  - Pre-built merchant themes: *Modern Clean*, *Batik Nusantara*, *Bold Direct-Response*, *Minimal Luxe*.
- **Live Theme Customizer:**
  - Visual editor in `@tokophi/admin` with real-time iframe preview of storefront changes.
  - Zero layout shift: Dynamic CSS variable injection via `<style id="tokophi-tenant-theme">`.

---

## 3. Frontend Architecture Perfection

### 3.1 Astro 5 Storefront Engine
- **HTML-First Baseline:**
  - 100% server-rendered static HTML with progressive enhancement for interactive widgets.
  - Zero heavy framework runtime on storefront root layout (vanilla TypeScript islands for Search Palette & Order Funnel).
- **Core Web Vitals Guarantee:**
  - **LCP:** < 1.0s (Hero banner inline WEBP + `fetchpriority="high"`).
  - **CLS:** 0.00 (Aspect ratio placeholders on product images).
  - **INP:** < 80ms (Delegated event handlers for cart update actions).

### 3.2 Next.js 16 Admin & Super-Admin Consoles
- **App Router & Server Actions:**
  - Use React Server Components (RSC) for data-dense tables (Order List, Product Catalog, Ledger Transactions).
  - Server Actions with optimistic UI updates for instant status changes.
- **Micro-Frontend Architecture:**
  - Modular package structure: `@tokophi/ui` (shadcn components), `@tokophi/db` (Drizzle ORM), `@tokophi/lib` (shared utilities).

---

## 4. Backend & Database Architecture Perfection

### 4.1 PostgreSQL 16 + Drizzle ORM Multi-Tenancy
- **Strict Row-Level Security (RLS):**
  - Session variable isolation: `SET LOCAL app.current_store_id = '<STORE_ID>'`.
  - Production database connection runs under unprivileged `tokophi_app` role.
- **High-Concurrency Stock & Order Pipeline:**
  - Row locking (`FOR UPDATE`) during inventory allocation to prevent negative stock.
  - Bounded rate limiting and payload size limits on public checkout endpoints.

### 4.2 Signal Engine & Outbox Reliability
- **Meta CAPI / TikTok / Google Ads Dual-Path:**
  - Server outbox pattern (`capi_events`) ensuring zero lost conversion signals.
  - SHA-256 PII normalizer maximizing Event Match Quality (EMQ).

---

## 5. Implementation Milestones

| Phase | Focus Area | Deliverable | Success Criterion |
| :--- | :--- | :--- | :--- |
| **Phase 1** | **Security & RLS Hardening** | `tokophi_app` DB role segregation & secret encryption | 0 cross-tenant data leaks |
| **Phase 2** | **Checkout & Payment Polish** | Atomic voucher increment & server COD limit guard | 0 double-deductions |
| **Phase 3** | **Theme Engine Integration** | `@tokophi/theme-engine` CSS variable injector | Live preview < 50ms render |
| **Phase 4** | **Tracking & Notification Outbox** | WA notification retry queue + Meta CAPI EMQ boost | CAPI EMQ score > 8.5/10 |
| **Phase 5** | **Performance & A11y Verification** | Modular TypeScript client scripts & ARIA live regions | LCP < 1.0s, A11y 100% clean |
