# Rules index — the detail behind the short rules in `AGENTS.md`

`AGENTS.md` is loaded in full into every AI session and Claude Code warns above 150k chars, so each long section there
keeps a digest of the load-bearing rules and points here for the reasoning and incident history.
**Put new incident detail in the matching file below and keep only the one-line rule in `AGENTS.md`**
(`test/agents-md-size.test.ts` fails the suite long before the limit).

| File | Read it before… |
|---|---|
| [`billing.md`](./billing.md) | billing, suspension, invoices, payouts, payment channels |
| [`checkout-validation.md`](./checkout-validation.md) | `checkout.astro`, `@tokophi/lib/validate`, any checkout field |
| [`dashboard-analytics.md`](./dashboard-analytics.md) | a dashboard / analytics number, KPI or delta |
| [`database-rls.md`](./database-rls.md) | any DB read/write, a pool change, an RLS policy or a child-table write |
| [`migrations.md`](./migrations.md) | adding, renumbering or applying a migration |
| [`order-ledger.md`](./order-ledger.md) | order status, payments, ledger, payouts, action error shapes |
| [`promo-vouchers.md`](./promo-vouchers.md) | discounts, vouchers, flash sales, code uniqueness |
| [`public-api.md`](./public-api.md) | any `api/public/**` route, a cron route, the pay callback |
| [`shipping-cod.md`](./shipping-cod.md) | checkout, ongkir, COD, shipments, cancel, courier integration |
| [`store-builder-landing.md`](./store-builder-landing.md) | templates, sections, renderer, landing HTML, capabilities |
| [`storefront-perf.md`](./storefront-perf.md) | images, fonts, pixels, scripts or layouts on the storefront |
| [`super-admin.md`](./super-admin.md) | super-admin actions, platform rank, impersonation, operator/merchant credentials |
| [`testing-guards.md`](./testing-guards.md) | writing a test that reads source, or when a guard is unexpectedly green |
