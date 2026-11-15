# Repo review & research-backed recommendations — 2026-11-02

**Status:** proposal. Nothing here was applied. Read-only review by the Main Session (Claude).
**Scope:** whole monorepo (`apps/*`, `packages/*`, `ops/`, CI, docs) + what is *not yet built or not yet closed*.
**Not a second task board.** Root `TASKS.md` stays the only queue; items marked ▶ should be promoted there by the owner/session that holds it. This file is dated evidence, like its siblings in this directory.

## How to read the evidence

| Tag | Meaning |
|---|---|
| **[M]** | Measured by me on 2026-11-02 (command given). |
| **[D]** | Taken from a repo document dated as shown; not re-measured. |
| **[R]** | From web research; sources at the end. Mostly vendor blogs / law-firm notes — treat as directional, verify against primary text before acting. |
| **[J]** | Engineering judgment, no external evidence. |

Already-tracked work (finance audit 8.24–8.32, KiriminAja UAT/8.9, go-live 8.33/8.34, affiliate test gaps, N-series in `OPEN.md`) is **not re-filed**; section 9 only says where it ranks against the new items.

## Snapshot (what the repo is, today)

- 4 surfaces + 5 packages; ~830 TS/TSX/Astro source files, 195 test files, 116 migrations (`0000`–`0115`), RLS on every store-scoped table, CI with a real Postgres, `verify-*` guards. **[M]** `find`/`ls`.
- Production moved to a dedicated Vultr SGP host (`vhp-2c-4gb-amd`, Coolify 4.5.3) on 2026-11-01 **[D]** `2026-11-01-dedicated-vps-bootstrap.md`.
- The repo is **public** since 2026-10-29 **[M]** `gh repo view` → `PUBLIC`.

The engineering discipline is unusually strong (guards proved red, incident history in-repo). The gaps below are mostly **outside the code's own guard rails**: supply chain, runtime hardening, compliance, operations, and the money-adjacent features that exist as schema but not as flow.

---

## P0 — do first (days)

### 1. ▶ Production cannot ship parcels: KiriminAja rejects the new egress IP
**[D]** bootstrap doc, "Open after cutover": the new host IP got HTTP 401; `cron-tracking` is **stopped** (restart policy `no`); 3 live orders affected; quotes/bookings/cancels fail.
**Do:** owner adds the IP at KiriminAja (same action as 2026-09-09), then re-enable `cron-tracking` as the doc says. Confirm the AutoLaris callback/IP allow-list too.
**Also from the same doc, still open:** repo `ops/tokophi-custom-domains.yaml` must be `priority: -1` (prod already runs it; the repo would regress the next fresh host); install `retry-global`; Access bypass for the GitHub webhook path.
**Done when:** `ops/tokophi-probe.sh` `ongkir-rates` passes from off-box and `cron_runs` shows a fresh `cron-tracking` tick.

### 2. ▶ Orders between the dump and the cutover may be missing
**[D]** "Any order or payment made after that dump (2026-10-27 06:25 UTC) and before cutover is not in this database." Cutover was 2026-11-01 18:53 UTC — a five-day window on a live shop.
**Do:** the old host / R2 offsite dumps (R2 sync is live since 2026-10-10 **[D]** `STATUS.md`) are the source. Diff `orders`, `payments`, `ledger_entries`, `customers` by `created_at > '2026-10-27 06:25'` against the old DB or latest R2 dump; replay anything missing; then `npm run verify-ledger -w @tokophi/db` on the new DB.
**Why P0:** money rows. A missing paid order is a seller who was charged and never sees the sale.

### 3. ▶ Supply chain: `npm audit --omit=dev` reports 3 critical / 19 high
**[M]** `npm audit --omit=dev --json` → `{low:2, moderate:36, high:19, critical:3}`. CI has **no** audit step **[M]** (`grep audit .github/workflows/ci.yml` → none).
Direct dependencies the audit flags, with the fix it proposes **[M]**:

| Package (where) | Installed range | Fix offered | Why it matters here |
|---|---|---|---|
| `next` (admin, super-admin) | 16.2.9 | 16.4.3 (**not** a major) | Advisory titles include *Middleware/Proxy bypass in App Router with Turbopack*, Server Actions DoS and SSRF. Admin's login gate starts in `middleware.ts`; the real boundary is `requireCapability`/`platformGate`, so this is defence-in-depth loss, not an open door — but it is a one-minor-version bump. |
| `sharp` (admin upload path) | 0.34.5 | 0.35.5 (major) | libvips/libheif/librsvg CVEs. Admin runs `sharp` on **merchant-uploaded files** (`lib/image-store.ts`) — attacker-controlled input, so this is the most *reachable* of the list. |
| `drizzle-orm` (`packages/db`) | ^0.36.4 | 0.45.4 (major) | SQL injection via improperly escaped **identifiers**. Reachability needs a dynamic identifier in a query; grep for `sql.identifier`/dynamic column names before judging. 9 minors behind also means missing fixes. |
| `astro`, `@astrojs/node` (storefront, landing) | 5.14.x / 9.2.x | 7.4.4 / 11.1.9 (major) | XSS in `define:vars`, spread-props XSS, server-island issues, request-body DoS. `docs` is already on Astro 7, so the repo already carries both majors. |

**Do:** (a) bump `next` now (non-major) → run `test:release`; (b) schedule `sharp` and `drizzle-orm` next, each its own PR with the migration/upload suites; (c) Astro 5→7 as a planned task (storefront is the shopper-facing surface — run `npm run verify -w @tokophi/storefront` + the pixel-defer/srcset checks); (d) add `npm audit --omit=dev --audit-level=high` to CI as **non-blocking first**, blocking once the baseline is 0. Audit severity is not reachability — triage each, but do not leave the three criticals unexamined on a public repo.
**Done when:** audit `--omit=dev` high+critical = 0 or each remaining entry has a written "not reachable because…".

### 4. ▶ The repo is public — scan history and scrub infrastructure identifiers
**[M]** `gh repo view` → `PUBLIC`. `git grep` finds the production IPs in **37 tracked files** (AGENTS.md, ARCHITECTURE.md, SLA-DRP, DEPLOY, `ops/tokophi-probe.sh`, several tests …). `AGENTS.md` also names the SSH key file and the `ssh root@…` command for the old host; the bootstrap doc lists the new IP, Coolify app uuid, API-token name and the Access setup — while itself saying such identifiers "belong in device-local records, not this repository".
**Risk [J]:** an IP behind Cloudflare is recon value (origin exposure — AUDIT-FULL ②, `:443` by IP bypassing Cloudflare is already an open owner item), and runbooks that show exact ports/paths shorten an attacker's work. No secret was found by me — I did not run a scanner (none installed: `which gitleaks trufflehog` → empty).
**Do:** run `gitleaks detect` (or `trufflehog git`) over **full history** once; rotate anything found (rotation, not history rewrite, is what actually closes a leak). Move IPs/uuids/token names to `~/.config/ai-local/` and reference by alias in docs (`PROD_HOST`); lock the origin to Cloudflare IP ranges + authenticated origin pulls so a leaked IP is inert. Add `gitleaks` to CI.
**Separate owner decision (already in `OPEN.md`):** 283 commits carry an AI `Co-authored-by` trailer; a rewrite is a force-push and needs approval of the exact command.

### 5. ▶ No browser-side hardening headers on any live surface
**[M]** `curl -sI` on `app.tokophi.com/login`, `toko.tokophi.com/`, `tokophi.com/` → only `strict-transport-security` (Cloudflare) is present. **No** `Content-Security-Policy`, `X-Frame-Options`/`frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`. In code, only `X-Robots-Tag` is set (`apps/admin/next.config.ts`, `middleware.ts`); CSP appears only on the uploads route and `image-content.ts`.
**Why it matters [J]:** (a) the Seller panel is clickjackable (no frame-ancestors) — it holds payout and credential screens; (b) the repo already documents that raw landing HTML **executes** on the shop origin (`set:html`, owner-only, "no CSP") — a CSP is the only layer that limits what a compromised owner account or a stored-XSS bug can do; (c) `nosniff` matters for the uploads route that serves user files.
**Do (in order of cost):** 1) `X-Frame-Options: DENY` + `frame-ancestors 'none'` on admin/super-admin; `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, a minimal `Permissions-Policy` everywhere — set once in Cloudflare Transform Rules or per-app `headers()`. 2) CSP for admin/super-admin in **Report-Only** first (Next needs nonces/hashes; Base UI is fine). 3) Storefront CSP last and Report-Only for a long time — pixels (Meta/TikTok/GA) and merchant landing HTML make a strict policy a real project; do not break the pixel-deferral invariant.
**Done when:** `curl -sI` shows the headers on all four surfaces and CSP reports are collected for a week without legitimate violations.

---

## P1 — next (weeks)

### 6. ▶ Compliance: UU PDP / PP 33/2026 lands 16 Jan 2027 and `PRIVACY-COMPLIANCE.md` is an empty placeholder
**[M]** `specs/docs/PRIVACY-COMPLIANCE.md` is 14 lines and says it "carries no policy text on purpose". No `UU PDP`/`PDP` string in it.
**[R]** PP 33/2026 (signed 16 Jul 2026) is reported to take effect **16 Jan 2027** — ~10 weeks away; it adds breach-notification duties (reported as 3×24 h, Art. 114–118 per RSM), internal incident records, and administrative fines up to ~2% of annual revenue; the supervisory agency is still not fully formed. **These are secondary summaries — have counsel read the PP text.**
**Where TokoΦ sits [J]:** *processor* for each merchant's shopper data (names, phones, addresses, order history, WhatsApp numbers, hashed identifiers sent to Meta/TikTok/Google via CAPI) and *controller* for merchant/operator accounts and billing data. Sub-processors in the code: KiriminAja, AutoLaris, Meta/TikTok/Google CAPI, Cloudflare, R2, Vultr.
**Build, smallest first:** (1) a real `PRIVACY-COMPLIANCE.md`: data inventory (tables → purpose → retention), sub-processor list, who is controller vs processor; (2) a **breach runbook** (detect → decide → notify merchants within the window) — you already have the right logs (`platform_activity`, `cron_runs`); (3) merchant **DPA** text in the signup terms; (4) storefront privacy-policy page template each store gets by default (Indonesian), including the CAPI/ads disclosure; (5) per-shopper **export + delete/anonymise** action in Seller (the schema already distinguishes `registered_at IS NULL` guests; anonymise must keep ledger/tax rows intact); (6) retention job for `checkout_sessions`, abandoned carts, `rate_limit_counters`, log tables.
**Done when:** the doc is reviewed by counsel, and one test shows a shopper's PII is gone from every table after the delete action while ledger sums still reconcile.

### 7. ▶ Observability: you can see the box from inside, but not errors and not from outside
**[M]** no Sentry/OpenTelemetry dependency anywhere (`grep -ril 'sentry|opentelemetry'` → none). **[D]** `OBSERVABILITY.md`: the external probe `ops/tokophi-probe.sh` "runs on no machine on a schedule" (Task 8.1, owner-gated), and the 70-hour outage of Sept 2026 was found by a merchant. The host is again a **single VPS**, one region **[D]** SLA-DRP §6.
**Do, cheapest first:** 1) off-box uptime + the two POST probes (Cloudflare Health Checks/Notifications, or a free external monitor, or the existing script on a different small host/GitHub Actions cron) with a push to WhatsApp/Telegram — unblocks Task 8.1 without the "alert channel decision" blocking it; 2) a Vultr balance alert/auto-pay (Task 8.2 — the exact failure of Sept); 3) error tracking: self-hosted GlitchTip or hosted Sentry free tier, wired through `instrumentation.ts` (Next) and an Astro middleware catch — today an exception in a Server Action is a `console.error` that nobody reads; 4) a request-id + `store_id` field on every log line so one order can be followed across admin → storefront → cron.
**Done when:** a deliberately stopped container pages a human within 10 minutes, and a thrown error in a Server Action shows up in the tracker with store + route.

### 8. ▶ Production sizing & the build-on-the-box risk
**[D]** new host = 2 vCPU / 4 GB, running Coolify (+its Postgres/Redis), Traefik, Postgres 16, 4 web apps + docs + 5–6 sidecars: "All 16 containers healthy". Coolify builds Docker images **on the same machine** (Next 16 + Astro builds are memory-hungry).
**Risk [J]:** a deploy can OOM-kill Postgres or the apps; the old host's "deploy 81–115 s → 7–8 s" win was about downtime, not build memory. **Measure before believing:** `free -m` and `docker stats --no-stream` during a deploy; check `dmesg | grep -i oom`.
**Do:** build in GitHub Actions → push to GHCR → Coolify deploys the image (Coolify supports image-based apps) so the origin never compiles; set container `mem_limit`s so the biggest consumer dies first (never Postgres); add 2 GB swap on the host (swappiness is already tuned); decide whether Postgres belongs on a separate managed/volume-backed node once the store count grows (SLA-DRP "one VPS" row).

### 9. Order of already-tracked money work (don't re-file; this is a ranking note)
Per `OPEN.md`: F9 callback capture and F12 refund fact gate any production switch. Insert items 1–2 above **before** 8.34's go-live, because go-live runs on the new host. Affiliate test gaps (`attachAffiliateCommission` wiring) are lower than anything in P0 but cheap — do them with item 11.

### 10. COD is 60–70% of Indonesian e-commerce and your funnel has no outbound confirmation step
**[R]** COD ≈ 60–70% of transactions in Indonesia; return-to-sender 25–35% in some categories (eGrow 2026 — vendor figure, not independent); vendor data says a WhatsApp confirmation within 30 min confirms ~75–82% of orders vs ~40–50% after 24 h, and offering a prepaid switch converts 8–12% of COD buyers (India benchmark). **[M]** Today the recovery flow is `wa.me` click-to-chat ("WA dibuka", seller-side, manual) and the schema already separates `batal` from `retur` and tracks the COD return rate.
**Design, respecting the repo's rules ("buying never requires an account", over-validation is a bug):**
1. Seller-side **"Konfirmasi COD" queue** on Pesanan: new COD orders get a one-tap templated WhatsApp message (order number, items, total, "balas YA"), with a status chip `menunggu konfirmasi → terkonfirmasi / tidak dibalas`. No change to the order state machine (`applyOrderStatusChange` stays the one writer) — it is a *fact on the order*, like `payments.method`.
2. Measure first: confirm-rate and `retur` rate by confirmed vs unconfirmed, per store, in Analitik (derive from `orders`, no rollup — repo rule).
3. Only then automate via the official WhatsApp Business **Cloud API** (needs pre-approved template messages and a Meta business verification; cost per conversation) — start per-store opt-in.
4. A "bayar sekarang, hemat ongkir/diskon kecil" prepaid-switch nudge on the COD thanks page, behind the flash/discount rules.
5. **Do not** build a cross-store phone blocklist — sharing shopper PII between merchants is exactly what PP 33 makes risky. A per-store, per-phone history (their own orders only) is fine.
**Done when:** one pilot store shows confirm-rate and retur-rate before/after on its own orders.

### 11. Test strategy: the two incidents that hurt were in places the suite can't see
**[M]** 195 test files, `npm test` runs `astro check` + vitest; no coverage tool configured (`grep coverage vitest.config.ts package.json` → none); the only browser automation is the storefront `verify` checks (perf/markup), not the checkout *flow*. **[D]** the repo's own history: `queueSave is not defined` blocked all orders with typecheck/lint/build green; `select … for update` in `requestPayout` passed `tsc` and failed in Postgres.
**Do:** (a) one Playwright **checkout smoke** in CI — product → cart → kecamatan pick → COD order → thanks page — with the shipping quote stubbed (the same gap `OPEN.md` names for the affiliate wiring), asserting 0 console errors; (b) a second smoke for Seller: login → Proses → Atur pengiriman against the sandbox stub; (c) turn on vitest coverage as a *report* (no threshold) for `packages/lib` + `apps/admin/lib` money modules, then ratchet like `verify-source-size` does; (d) make the red-proof habit mechanical: a `mutation` script that flips one operator in a guarded file and expects the suite to fail (Stryker is overkill — a 30-line script over the 5 money files is enough).

### 12. Admin lint is still red and gates nothing
**[M]** 23 `eslint-disable` in source; `ci.yml` comments say Seller lint is deliberately omitted "because red". **[D]** `AGENTS.md`: 28 errors on 2026-07-31, includes React-Compiler rules that cause remounts and hydration mismatches. A gate that is off is a gate that rots; this is the same lesson as the CI one.
**Do:** triage the errors (an afternoon), fix or per-line disable with reason, then add `npm run lint` to CI. Add `lint` scripts for the two Astro apps (ARCHITECTURE_RECOMMENDATIONS already asks for this).

### 13. Reduce Storefront database privilege (already a P1 in ARCHITECTURE_RECOMMENDATIONS — reaffirmed, with a test)
**[D]** `AGENTS.md`: storefront/public API/cron stay on the owner connection with explicit `store_id` predicates. The new deploy has a `tokophi_platform` role with `BYPASSRLS` **[D]** bootstrap doc, which is the right direction for platform paths.
**[R]** Consistent guidance: RLS is the last line, not the only line; test **as the app role**, not as owner; owners/BYPASSRLS skip policies; use `SET LOCAL` inside a txn for pooled connections.
**Do:** a read-only `tokophi_store` role with `SELECT` on published-shopper views only; a mutation test that deletes the `store_id` predicate from one storefront query and proves the role still can't read another tenant (this is the ARCHITECTURE_RECOMMENDATIONS "done when"). Keep order creation behind the existing admin public API.

---

## P2 — worth doing, not urgent

### 14. Search: no trigram/FTS index in any migration
**[M]** `grep -E 'pg_trgm|tsvector|gin' packages/db/drizzle/*.sql` → no index definition (only unrelated `gin…` substrings in column names). Ongkir area search is `ILIKE` over `kiriminaja_areas` **[D]**.
**[R]** For small catalogs Postgres FTS + `pg_trgm` is usually enough; Postgres ships no Indonesian dictionary, so use `simple` + `unaccent` and let trigrams carry typos; a dedicated engine (Meilisearch) adds an operational component — only test it if real queries fail.
**Do:** collect 200 real shopper queries (the search palette already exists), measure hit-rate, then add `pg_trgm` GIN on `products.title`/`variants.sku`/`kiriminaja_areas.name` in a hand-written idempotent migration (repo rule: never `generate`). Re-measure. Skip Meilisearch unless the numbers say otherwise.

### 15. HTML is never edge-cached
**[M]** `curl -sI https://toko.tokophi.com/` → no `Cache-Control`; Cloudflare does not cache HTML by default, so every storefront view hits the 2-vCPU origin. **[D]** the product pitches storefront speed (LCP goals in `TOKOPHI_PERFECTION_ROADMAP.md`).
**Do (careful — multi-tenant, prices, flash sales, pixels):** `Cache-Control: public, s-maxage=60, stale-while-revalidate=300` on **anonymous GET** product/category/home pages only, with a Cloudflare Cache Rule bypassing on any cookie that marks a cart/session; purge by tag when a seller saves; measure with a flash-sale price flip so staleness never exceeds the window. The flash-sale `isLive` clock rule in `AGENTS.md` is the invariant to protect — if a stale page can show a price the checkout re-quote rejects, the window is too long. Gate behind a per-store flag first.

### 16. God files and the extraction that keeps being deferred
**[M]** `checkout.astro` 2848 lines (the ceiling guard allows 2864), `order-detail.tsx` 1827, `shipping.ts` 1580, `product-editor.tsx` 1570, `order/route.ts` 1497. The ceiling guard stops growth but the split waits on Tasks 5.4/5.6.
**[J]:** the checkout inline `<script>` is where the worst outage hid. The cheapest safe step is **not** a split of the page — it is moving the client script into typed TS modules (`checkout/shipping.ts`, `checkout/validate.ts`, `checkout/save.ts`) imported by the page, so `tsc` sees the call sites that `astro check` currently can't. That alone would have caught `queueSave`.

### 17. Docs sprawl
**[M]** ~55 files in `specs/docs`, several overlapping (`PERFECTION_ROADMAP`, `ARCHITECTURE_RECOMMENDATIONS`, `IMPROVEMENT_UIUX`, `PATTERN_UIUX`, `AUDIT_*`, `MASTER_ENGINEERING_REPORT`). `TOKOPHI_PERFECTION_ROADMAP.md` (2026-08-15) names a `@tokophi/theme-engine` package that does not exist in `packages/` **[M]** `ls packages` → db, lib, sections, ui. `SLA-DRP.md` §7 still runs the recovery runbook against the old host IP.
**Do:** mark superseded docs with a banner and a pointer (don't delete — history), regenerate volatile counts (table/migration counts are already guarded by `doc-counts.test.ts`; extend the idea), and update the SLA-DRP runbook/SPOF table for the new host in the same PR as the cutover record.

### 18. Backups: prove the restore on the new host
**[D]** offsite to R2 live since 2026-10-10, restore proven once (Task 8.4), on the old box. The new host re-created all of it.
**Do:** after item 2, run the documented restore-from-R2 into a throwaway DB **on the new host**, time it, write RTO/RPO into SLA-DRP §3. Schedule it quarterly (a calendar reminder is enough).

---

## Suggested sequencing

| When | Items |
|---|---|
| This week | 1, 2, 3(a: `next` bump), 4 (history scan), 5 (cheap headers), 7(1,2) |
| Before 8.34 go-live | 3(b–d), 7(3), 8, 13, 18 |
| Before 16 Jan 2027 | 6 (counsel review needs lead time — start now) |
| Q1 2027 | 10, 11, 12, 15, 14, 16, 17 |

## Things I deliberately did **not** recommend

- **No microservice/`apps/api` extraction, no queue, no Kubernetes.** Same conclusion as `ARCHITECTURE_RECOMMENDATIONS.md`; nothing measured justifies it.
- **No Meilisearch/Elasticsearch** before the trigram numbers are in.
- **No cross-merchant fraud/blocklist** — privacy cost exceeds the benefit under PDP.
- **No history rewrite as a security fix** — it does not un-leak anything; rotate.
- **No regex sanitizer for landing HTML** — `AGENTS.md` already says why; CSP (item 5) is the right layer.

## Limits of this review

- I did not run the test suite, the browser flows, `verify-rls`, or touch production beyond three public `HEAD` requests.
- `npm audit` reports advisories, not exploitability; reachability for `drizzle-orm` and `astro` still needs a per-advisory read.
- No secret scanner was available, so item 4 is a recommendation to scan, not a finding of a leak.
- Legal points come from secondary sources and need counsel; COD figures are vendor-reported and mostly non-Indonesian benchmarks.
- Per the repo protocol, I did **not** edit `TASKS.md`, `BUILD-LOG.md` or `STATUS.md`: they hold another session's uncommitted changes. Whoever integrates this should add the `BUILD-LOG` line and promote the ▶ items.

## Sources

- [SIP Law Firm — PP 33/2026 PDP](https://siplawfirm.id/resources/pp-33-2026-pelindungan-data-pribadi) · [RSM Indonesia client alert, 18 Sep 2026](https://www.rsm.global/indonesia/en/node/439) · [Veritask summary of PP 33/2026](https://veritask.ai/id/artikel/pengaturan-teknis-pelindungan-data-pribadi-dan-kewajiban-pengendali-serta-prosesor-akhirnya-terbit-lewat-pp-33-2026) · [Bisnis.com, 2 Sep 2026](https://teknologi.bisnis.com/read/20260902/84/2000857/masyarakat-dapat-gugat-dan-terima-ganti-rugi-atas-pelanggaran-data-pribadi) · [CNBC Indonesia on the PDP agency](https://www.cnbcindonesia.com/tech/20260204144446-37-708158/telat-2-tahun-komdigi-janji-badan-penjaga-data-warga-ri-berdiri-2026)
- [eGrow — Indonesia COD & WhatsApp 2026](https://www.egrow.com/en/blog/indonesia-cod-whatsapp-ecommerce-2026) · [eGrow — raising COD confirmation rate](https://www.egrow.com/en/blog/how-to-increase-order-confirmation-rate-in-cod-e-commerce-a-data-driven-guide-2026) · [AiSensy — reduce RTO with WhatsApp](https://m.aisensy.com/blog/reduce-rto-with-whatsapp/)
- [OneUptime — Postgres RLS](https://oneuptime.com/blog/post/2026-01-25-use-row-level-security-postgresql/view) · [DEV — RLS for multi-tenant SaaS](https://dev.to/endurance-softwares/postgresql-row-level-security-for-multi-tenant-saas-3gc1) · [AppMaster — RLS multitenant patterns](https://appmaster.io/blog/postgresql-row-level-security-multitenant-patterns)
- [OneUptime — Postgres full-text search](https://oneuptime.com/blog/post/2026-01-21-postgresql-full-text-search/view) · [chat2db — pg_trgm](https://chat2db.ai/resources/blog/postgres-pg-trgm-fuzzy-text-search)
- Advisories cited from `npm audit` output (GitHub Advisory Database): GHSA-6gpp-xcg3-4w24 (Next), GHSA-gpj5-g38j-94v9 (drizzle-orm), GHSA-f88m-g3jw-g9cj (sharp), GHSA-j687-52p2-xcff / GHSA-jrpj-wcv7-9fh9 (Astro), GHSA-3rmj-9m5h-8fpv (@astrojs/node).

## Progress — 2026-11-02 (branch `chore/hardening-2026-11`, uncommitted; see BUILD-LOG)

| Item | State |
|---|---|
| 1 | KiriminAja whitelist confirmed by the owner; `op=rates` on production now 200 with COD. `cron-tracking` restarted with owner go 2026-11-02 (healthy, 0 errors, 0 problems on first tick). Repo `priority: -1` done. `retry-global` / webhook Access bypass open. |
| 2 | Open — needs production/R2 access. |
| 3 | `next` → 16.4.3 done and built. `sharp`, `drizzle-orm`, Astro/`@astrojs/node` majors open. CI `npm audit` added (advisory). |
| 4 | History pattern scan clean; no gitleaks run; infra identifiers still in 37 tracked files. |
| 5 | Headers shipped + guard (`test/security-headers.test.ts`); CSP Report-Only still open. |
| 12 | Corrected: lint was already 0 errors; now a CI gate. Astro apps still lack `lint`. |
