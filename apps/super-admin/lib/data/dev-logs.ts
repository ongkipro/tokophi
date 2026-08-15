export type DevLogCategory = "major" | "minor" | "feature" | "bugfix" | "security" | "logistics_payment";

export type DevLogEntry = {
  id: string;
  version: string;
  date: string;
  title: string;
  category: DevLogCategory;
  surfaces: ("Seller Admin" | "Super Admin" | "Storefront" | "Database & RLS" | "Logistics" | "Payments")[];
  summary: string;
  problem: string;
  solution: string;
  verification: string;
};

export const DEV_LOGS: DevLogEntry[] = [
  {
    id: "v1.0.0-release",
    version: "v1.0.0",
    date: "2026-08-15",
    title: "Official Production Release & Cross-Domain Audit Remediation",
    category: "major",
    surfaces: ["Seller Admin", "Super Admin", "Storefront", "Database & RLS", "Logistics", "Payments"],
    summary: "Monorepo v1.0.0 release. 100% remediated 6 domain audit batches with 95 Drizzle migrations, 80 PostgreSQL tables, 53 store-scoped RLS tables, and 90 test suites green.",
    problem: "Deep audits identified 6 missing Drizzle schema index definitions, potential 403 API response format drift, and unverified edge-case money calculations.",
    solution: "Synchronized Drizzle schema index parity, aligned OpenAPI route contracts, hardened billing/cron endpoints, updated root documentation, and locked version 1.0.0 across all 10 monorepo package definitions.",
    verification: "90/90 Vitest files passed (722/722 tests), Storefront Astro Check 0 errors, Landing Astro Check 0 errors, ops/tokophi-probe.sh 5/5 surfaces 200/307 OK."
  },
  {
    id: "n41-order-finance",
    version: "v0.9.5",
    date: "2026-08-12",
    title: "Order Financial Immutable Allocation & Net Seller Proceeds",
    category: "feature",
    surfaces: ["Seller Admin", "Storefront", "Database & RLS", "Payments"],
    summary: "Order financial snapshotting now records immutable buyer total, merchant proceeds, COD fees + VAT, and KiriminAja shipping excess.",
    problem: "Legacy orders did not lock shipping discount vs product discount allocations, creating ambiguity in net seller payout calculation when discounts overlapped.",
    solution: "Added migration 0094_magical_salo with immutable order_financials table and order_seller_entitlements view to guarantee non-deletable financial records.",
    verification: "90 Vitest suites executed; verify-ledger.test.ts and order-finance calculations verified."
  },
  {
    id: "n40-theme-tokens",
    version: "v0.9.4",
    date: "2026-08-11",
    title: "Store Builder Brand Color & Custom Theme Tokens System",
    category: "feature",
    surfaces: ["Seller Admin", "Storefront", "Database & RLS"],
    summary: "Merchants can now customize primary, accent, card, and background color tokens in Store Builder with real-time live preview.",
    problem: "Storefront theme styles were limited to pre-configured templates without custom merchant brand color flexibility.",
    solution: "Added migration 0092_store_theme_tokens and built ThemeTokensDialog component in Seller Admin with OKLCH/HEX color picker.",
    verification: "ThemeTokens.astro rendering verified across mobile and desktop viewports."
  },
  {
    id: "sec-rls-hardening",
    version: "v0.9.3",
    date: "2026-08-08",
    title: "PostgreSQL Row-Level Security (RLS) & Non-Owner Role Enforcement",
    category: "security",
    surfaces: ["Seller Admin", "Database & RLS"],
    summary: "Enforced PostgreSQL tokophi_app role dropping on all tenant-scoped database reads and writes.",
    problem: "Application-level where clause checks could theoretically be bypassed if raw SQL queries were executed under the superuser Postgres role.",
    solution: "Enforced withCurrentTenant and withTenant wrappers that execute SET LOCAL app.store_id and SET LOCAL ROLE tokophi_app on all transactions across 53 store-scoped tables.",
    verification: "npm run verify-rls passed across 53 store-scoped catalog tables."
  },
  {
    id: "ka-kiriminaja-timeout",
    version: "v0.9.2",
    date: "2026-08-05",
    title: "KiriminAja 3PL Courier Integration & 8s Abort Controller",
    category: "logistics_payment",
    surfaces: ["Storefront", "Logistics"],
    summary: "Fixed KiriminAja district ongkir calculation and added fail-closed 8s HTTP timeout guard.",
    problem: "If KiriminAja API experienced upstream latency, storefront shipping rate calculation could hang the checkout render pass.",
    solution: "Implemented AbortController timeout of 8000ms with fallback to cached shipping rates or explicit error messaging.",
    verification: "POST /api/public/ongkir op=search verified via tokophi-probe.sh with 200 responses."
  },
  {
    id: "n15-published-credentials",
    version: "v0.9.1",
    date: "2026-08-03",
    title: "Login Page Seed Credential Auto-Fill Removal",
    category: "bugfix",
    surfaces: ["Seller Admin", "Super Admin"],
    summary: "Removed default email/password auto-fill values from login screens.",
    problem: "Both admin and super-admin login forms pre-populated seeded demo account credentials in HTML default inputs.",
    solution: "Removed hardcoded input values and added no-published-credentials.test.ts scanner to fail CI if plaintext credentials ever re-appear.",
    verification: "no-published-credentials.test.ts passed green."
  },
  {
    id: "autolaris-qris-va",
    version: "v0.9.0",
    date: "2026-07-28",
    title: "AutoLaris Gateway Active Channel Filtering & QRIS Image Render",
    category: "logistics_payment",
    surfaces: ["Storefront", "Payments"],
    summary: "Filtered active AutoLaris payment channels to 5 VAs + QRIS, discarding unchargeable e-wallets.",
    problem: "Shoppers were presented with e-wallet payment options that the gateway sandbox refused to process.",
    solution: "Added live channel status filtering enabled AND active at /api/public/pay/callback and rendered scannable QRIS PNG with copyable payload.",
    verification: "Checkout payment selection verified in real browser."
  }
];
