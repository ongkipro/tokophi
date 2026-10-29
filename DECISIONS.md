# Decision Register — tokophi

Updated: 2026-09-11

> **Index only.** The full records live in `specs/decisions/` (ADRs) and, for owner rulings that
> never got an ADR, in the named section of `AGENTS.md` / `specs/docs/FINANCE.md`. Dates in the ADR
> table are the ADR's own `Date:` line where it has one, otherwise the file's first commit
> (`git log --diff-filter=A --date=short`). Never rewrite an entry; supersede it.

## Architecture Decision Records (`specs/decisions/`)

| ID | Status | Decision | Date | File |
|---|---|---|---|---|
| ADR 0001 | accepted | Stack: Next.js admin + Astro storefront, mock-data-first | 2026-07-02 | `0001-stack-and-mock-first.md` |
| ADR 0002 | accepted | shadcn/ui on **Base UI**, not Radix (`render` prop, no `asChild`) | 2026-07-02 | `0002-shadcn-base-ui.md` |
| ADR 0003 | partly superseded by 0009 | Scope (no Apps; "no Themes" reversed) + multi-tenancy model | 2026-07-02 | `0003-scope-and-multitenancy.md` |
| ADR 0004 | accepted | Payments, COD and shipping are **platform-managed**; provider brands hidden from merchants | 2026-07-02 | `0004-platform-managed-payments-shipping.md` |
| ADR 0005 | accepted | Monorepo with shared packages (npm workspaces) | 2026-07-02 | `0005-monorepo-shared-packages.md` |
| ADR 0006 | accepted | Shared nav source: auto-connect admin ↔ storefront | 2026-07-02 | `0006-shared-nav-source-auto-connect.md` |
| ADR 0007 | accepted | Persistence: Postgres + Drizzle (dev) → self-hosted Postgres on the VPS (prod) | 2026-07-03 | `0007-backend-postgres-drizzle.md` |
| ADR 0008 | accepted (single-tenant wording stale) | One control plane + one multi-tenant admin + storefront per client | 2026-07-03 | `0008-per-client-provisioning-model.md` |
| ADR 0009 | accepted | Self-serve Store Builder; one storefront container, tenant from `Host` | 2026-07-10 | `0009-self-serve-store-builder.md` |
| ADR 0010 | **deliberately never written** | Held for a courier-policy ADR whose curation was reversed; the live KiriminAja API is the roster (`packages/lib/src/couriers.ts`). Number stays unused — see the intake note in ADR 0012 | — | — |
| ADR 0011 | accepted | Standard product taxonomy (Google Product Category) beside the merchant's own | 2026-07-23 | `0011-product-taxonomy-google-category.md` |
| ADR 0012 | accepted | Meta Commerce integration uses **tenant-owned** assets; conversion built from the order row | 2026-07-28 | `0012-meta-commerce-tenant-owned-integration.md` |
| ADR 0013 | accepted | Stable, system-generated catalog product ids (`retailerId()`, one scheme per store) | 2026-07-29 | `0013-stable-catalog-product-ids.md` |
| ADR 0014 | superseded by 0015 (2026-08-12) | Platform absorbs the courier's shipping cost on COD orders | 2026-08-05 | `0014-platform-absorbs-cod-shipping.md` |
| ADR 0015 | accepted (owner, issue #180) | Net Seller proceeds + shipping reconciliation (`order-finance.ts`) | 2026-08-12 | `0015-net-seller-proceeds-and-shipping-reconciliation.md` |
| ADR 0017 | accepted (structural changes; the ~0 s options remain an owner decision) | Deploy window: health-first in-place swap on Coolify compose — consistent container names, `migrate` gate dropped from routed apps, `start_interval: 2s`; **81–115 s → 7–8 s** accepted as the floor (0016 reserved for Task 5.8) | 2026-08-28 | `0017-zero-downtime-deploy.md` |
| ADR 0018 | **proposed** (owner direction 2026-10-19; mechanics Q1–Q8 open; not implemented) | Affiliate commission is paid by the platform out of the seller's balance after true delivery; would supersede the AFFILIATE_SPEC §12 "merchant pays outside TokoΦ" decision | 2026-10-19 | `0018-affiliate-commission-paid-from-seller-balance.md` |

## Owner rulings without an ADR (recorded in `AGENTS.md` unless noted)

| ID | Status | Decision | Date | Evidence |
|---|---|---|---|---|
| DEC-001 | accepted | Subscription prices are DPP; PPN 11 % is a **global toggle** `platform_finance.subscription_ppn_enabled`, **default OFF** at launch | 2026-08-24 | migration `0101`; `specs/docs/FINANCE.md`; `subscriptionCharge()` in `@tokophi/lib/billing` |
| DEC-002 | accepted | Ad-platform conversion `value` = **goods only** (no ongkir, no admin fee) on Meta, Google, TikTok; GA4 carries `shipping`/`tax` separately | 2026-08-24 | AGENTS.md "Conversion tracking"; `apps/admin/lib/tracking-events.ts` |
| DEC-003 | accepted | Marking an invoice paid by hand is **bookkeeping** — it never moves `stores.current_period_end`; entitlement moves on payment events only | 2026-08-20 | `apps/super-admin/lib/invoice-flip-is-bookkeeping.test.ts` |
| DEC-004 | accepted | `platform_payment_gateways.enabled` is a **record, not a switch** — gates nothing; the "Aktif" badge was removed, the column kept | 2026-08-20 | `apps/super-admin/lib/gateway-enabled-is-not-a-gate.test.ts` |
| DEC-005 | accepted, amended by DEC-010/011 | Order fees (COD 3 % + PPN on fee, QRIS 0,7 % of omset, VA flat per bank, e-wallet pct) are **enforced** in checkout pricing, buyer pays | 2026-08-24 | `packages/lib/src/payment-fees.ts`; `/api/public/order` |
| DEC-006 | accepted | KiriminAja sandbox and production share one API contract; cutover is an endpoint swap only | 2026-08-03 | AGENTS.md "Shipping & COD" |
| DEC-007 | accepted | Marketing pixels load on **first interaction** (10 s backstop, no `requestIdleCallback`); the lost bounce-PageView is accepted | 2026-08-01 | `MarketingPixels.astro`; `scripts/check-pixel-defer.mjs` |
| DEC-008 | accepted | A delivery-ledger run that failed, was fixed and re-passed may still `PASS` ("resolved, not unblemished") | 2026-09-01 | `~/dotfiles/docs/task-change-boundary.md` |
| DEC-009 | accepted | Repository visibility is **public** since 2026-09-10 (seventh flip, owner order). History: private → public 2026-08-27→28 → private 2026-08-28 → public 2026-09-01→04 → private 2026-09-04 → public 2026-09-09 → private 2026-09-09 (sixth) → **public 2026-09-10**. The lever each time is GitHub Actions: public = free minutes, private = metered, and this repo's CI now builds four surfaces per PR. ⚠️ Contents have been publicly indexable since the first window, so a later private phase closes new access, it does not retract what was published. Rule (project memory): never flip without a new explicit owner order. | `gh api repos/ongkipro/tokophi --jq .visibility` → `public` (checked 2026-09-10); BUILD-LOG 2026-08-28, 2026-09-01, 2026-09-04, 2026-09-09, 2026-09-10 |
| DEC-010 | accepted (owner) | E-wallet fee **3,0 %** (from 2,4 %) — the provider bills the account 3,0 % (`list_payment`, measured), so 2,4 % was platform absorption | 2026-09-09 | `payment-fees.ts`; `autolaris-list-payment.test.ts` |
| DEC-011 | accepted (owner) | VA other banks **Rp3.000** (from Rp3.500); BCA stays Rp6.500 as the ONLY per-bank override. The provider bills Rp3.000 `fix` for BNI/Permata/Mandiri/BRI, so Rp3.500 was a **buyer overcharge**, not margin. The DEFAULT moved — no bank is Rp3.500, so four overrides equal to a default would leave a default matching nothing | 2026-09-10 | PR #390; `payment-fees.test.ts` ("BCA is the ONLY exception"); production checkout measured 3500 → 3000 |
| DEC-012 | accepted | Payment reconciliation via AutoLaris `advice` is **observe-only**: the cron records the answer distribution and settles nothing, because `advice` answers `02/FAILED` for bills still live and no PAID answer has been observed; `ADVICE_SETTLED` stays empty until the vendor confirms the mapping (go-live question #6). The callback route remains the one writer of payment state | 2026-09-11 | PR #392; `api/cron/payment-advice/route.test.ts` (source has no writer) |
| DEC-013 | accepted (owner) | ADR 0004 is **enforced by a guard**: no provider brand in any string a merchant or shopper can read; clients see `TokoΦ Kirim` / `TokoΦ Bayar`. Operators (super-admin) still see the real vendor | 2026-09-11 | PR #391; `packages/lib/src/provider-label.test.ts` |
| DEC-014 | accepted (owner) | Git history is **not rewritten** to remove AI co-author trailers on 282 historical commits — the cost (force-push over 1 163 commits, ~137 branches orphaned, a production rebuild) outweighs a cosmetic avatar; PR bodies were cleaned instead (131) and no new trailer is written | 2026-09-10 | BUILD-LOG 2026-09-10; global CLAUDE.md rule |
| DEC-015 | accepted (owner, as a **direction**) | Affiliate funds are releasable only after the goods have **truly been delivered**, and are funded by **debiting the seller's balance** (owner, verbatim: "dana affiliate bisa di cairkan setelah barang benar2 terkirim dan memotong saldo seller"). Reverses the 2026-10-15 "merchant pays outside TokoΦ" rule. **Not implemented**; mechanics, tax and liability are open in ADR 0018 | 2026-10-19 | [ADR 0018](specs/decisions/0018-affiliate-commission-paid-from-seller-balance.md); `specs/AFFILIATE_SPEC.md` OD-A5 |
| DEC-016 | accepted (owner) | **One account for buying and for affiliating** across many stores ("akun affiliate itu buat seperti akun user -> jadi bisa affiliate banyak toko bukan personal"); one shell, a Belanja / Affiliate switch; per-store data stays separate | 2026-10-15 | `specs/docs/TOKOPHI_ACCOUNT_SPEC.md` OD-3, §18.2 |
| DEC-017 | accepted (owner: "ya" to the recommendation) | A store's **return window is the store's own, optional, with no default**, and is not `affiliate_hold_days`; shown to the buyer only when declared; **a declared value is in hari kerja and at least 2, from the primary text of PP 80/2019 Pasal 69(1) (Main Session reading, owner to confirm; migration 0120)** (the research-derived rule that the complaint hand-off is not gated by it is a **proposal**, spec §20 RR-10) | 2026-10-19 | `specs/docs/TOKOPHI_ACCOUNT_SPEC.md` OD-9, ACC-16, §19; Tasks 10.22–10.23 |
| DEC-018 | accepted (owner) | TokoΦ Account is **local development only** until the feature is final: no push, no PR, no production, until the owner says so | 2026-10-15 | `specs/docs/TOKOPHI_ACCOUNT_SPEC.md` OD-5 |
| DEC-019 | accepted (owner adopted the recommendations: "rekomendasimu sempurnakan dan jalankan") | After the owner asked what needed a decision, the recommendations were adopted: (1) the return window is in **hari kerja** with a floor of **2** (DEC-017 addendum confirmed); (2) the complaint hand-off is **not** gated by the declared window (RR-10 confirmed); (3) OD-12 **stage 1** is built (store complaint-resolution period + a warning when the store has no WhatsApp number); (4) ADR 0018 Q1, Q3, Q6, Q7, Q8 and the first half of Q2 are answered as recommended (ADR §5); **Q5 (tax) stays open** — it needs a tax adviser and cannot be decided for the owner, so ADR 0018 stays *proposed* and Task 9.14 BLOCKED; a design-gate review round is run once at the end | 2026-10-19 | spec §19, §20; ADR 0018 §5; Tasks 10.24, 10.25; `specs/docs/tasks/2026-10-19-adviser-brief-tax-and-legal.md` |

Use stable IDs (`DEC-nnn`). When a ruling needs alternatives and consequences spelled out, write the
ADR in `specs/decisions/` (0016 is RESERVED for the buyer-account decision, Task 5.8 — `0016-global-buyer-account.md`, not yet written; next free number is **0019**) and link it here.
