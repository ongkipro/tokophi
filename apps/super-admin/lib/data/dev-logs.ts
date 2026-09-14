// Named and exported because the SCREEN has to narrow a filter string to it. It was an inline
// union here and an `as any` there, which is the shape that stops a wrong surface name failing.
export type DevLogSurface =
  | "Seller Admin"
  | "Super Admin"
  | "Storefront"
  | "Database & RLS"
  | "Logistics"
  | "Payments";

export type DevLogCategory = "major" | "minor" | "feature" | "bugfix" | "security" | "logistics_payment";

export type DevLogEntry = {
  id: string;
  version: string;
  date: string;
  title: string;
  category: DevLogCategory;
  surfaces: DevLogSurface[];
  summary: string;
  problem: string;
  solution: string;
  verification: string;
};

export const DEV_LOGS: DevLogEntry[] = [
  {
    id: "v1.7.1-sorting-code-tracking-body",
    version: "v1.7.1",
    date: "2026-09-14",
    title: "Shipping Labels Get The Courier's Sorting Code — And The Tracking Answer Is Finally Read",
    category: "logistics_payment",
    surfaces: ["Logistics", "Seller Admin", "Database & RLS"],
    summary: "KiriminAja confirmed the orders are correct and asked for one thing on the label: the sorting code that SPX, ID Express, J&T and J&T Cargo require. The field is now prepared end to end — stored with the waybill, filled from the courier's tracking answer and from its first webhook event, printed large above the barcode, and flagged on screen when it is missing. Wiring it exposed that no tracking answer had ever been read at all.",
    problem: "The sorting code is issued by the courier when the waybill is created and arrives on the first webhook event; the sandbox never issues one, so it can only be prepared, not observed. Reaching for it showed that every tracking consumer — the 15-minute poller, the webhook's verification pull and the seller's Lacak button — read a response field that does not exist, so every successful answer came back empty. Production's own log line had recorded an undefined status on every pull for weeks. And the sandbox's waybill turned out to be a mock built from our own booking reference, which the old check would have accepted and printed as a resi.",
    solution: "One parser now reads the tracking answer as the vendor documents it, and a single rule decides whether a value is a real courier waybill — refusing our own reference, anything containing it, and mock or demo numbers. A new order column holds the sorting code, written only by the one function that already owns tracking writes: from the verified tracking answer, or from a webhook row only when that row names the waybill we verified. It is validated before it is stored and cleared together with its waybill. The label prints it above the barcode; for the four couriers that require it the slot is always drawn, so a missing code reads as missing rather than as a complete label, and the bulk print screen names the orders that lack one.",
    verification: "Measured from the allow-listed production container against the sandbox: all eight UAT parcels answer status 105 with a mock waybill and a null sorting code, the exact shape now pinned as a fixture. Label rendered in Chromium at 100 by 150 millimetres in both states with no overflow. Full suite 1.551 tests, 0 failed, including a real-Postgres suite for the column's writer; eight source mutations each turned a guard red. Not yet proven: a real sorting code, which only a production booking can produce."
  },
  {
    id: "v1.7.0-kiriminaja-v62-payload-uat-revision-3",
    version: "v1.7.0",
    date: "2026-09-14",
    title: "The Courier Booking Speaks v6.2 In Full — Coordinates, Manifest, Quoted Insurance, The Right COD Value — After Two Vendor Reviews In One Day",
    category: "logistics_payment",
    surfaces: ["Logistics", "Database & RLS", "Seller Admin"],
    summary: "KiriminAja reviewed our UAT sheet twice on the same day. The first review said the endpoint was v6.2 but the payload was still v6.1; the second went booking by booking through the corrected run. Every remark is now enforced where the request is built: both coordinate pairs as village or district centroids, the item manifest with SKU and variant, the package quantity derived from that manifest, the insurance amount taken from the pricing call, force-insured services insured whether or not the seller asked, and the COD value on the vendor's own formula. The simulation re-booked eight of eight, including 4-kilogram volumetric parcels at their quoted price.",
    problem: "Nothing in the product held a coordinate for anyone — the seller's pickup columns were dead, the order had none, and the area tables carried no centroid — while the v6.2 schema marks four coordinate fields required. The insurance amount had been the goods value on every insured booking ever made; the vendor wants its own quoted fee. The package quantity was always 1. And, measured with four probe bookings, the v6.2 validator prices the manifest — the sum of every line's volume times its quantity — not the package box, so a quote built on the largest item per axis under-priced any multi-line order and the booking was refused as 'Ongkir tidak sesuai'.",
    solution: "A migration adds a centroid to every village and district from the Kemendagri boundaries dataset, keyed by the same codes the village table already carries, loaded through the reference CSVs the deploy already seeds; a single resolver picks the village centroid, else the district's, else nothing, and a sink guard refuses 0,0, a lone coordinate, or a point outside Indonesia. The parcel's box is now one rule for the checkout quote, the seller's re-quote and the booking: the largest footprint with a height that holds the summed item volumes, rounded up. The seller's rate list is quoted with insurance so every service carries its fee and its force-insurance flag; the booking uses that fee, forced or chosen. The package quantity is the manifest's sum. The COD value is the buyer's checkout total — goods plus shipping plus the 3 percent fee plus VAT — which is the vendor's formula for an uninsured parcel; insurance on a COD parcel is the seller's own cost and is not collected from the buyer.",
    verification: "Eight of eight sandbox bookings from the allow-listed production container with the full v6.2 body, four of them at 4.000 g volumetric on the vendor's own quote; the scenario-one request body captured off the wire and printed verbatim on the sheet. The manifest-volume rule proved by three accepted and one refused probe booking that differed in nothing but item volume. Full suite 1.518 tests, 0 failed; the new guards pin the centroid resolver against real Postgres, the box rule, the derived quantity, the quoted insurance, and that no coordinate can reach the vendor as zero. Still owner-gated: submitting revision 3 of the sheet, and the first real production booking."
  },
  {
    id: "v1.6.0-super-admin-front-door-mobile-nav",
    version: "v1.6.0",
    date: "2026-09-11",
    title: "Super Admin Gets A Front Door, A Phone-Sized Menu, A Theme Switch — And The Provider's Name Leaves The Seller Panel",
    category: "feature",
    surfaces: ["Super Admin", "Seller Admin", "Payments"],
    summary: "The control plane's login now has the same considered shape as the Seller's, an operator on a phone can finally reach every page through a drawer, the theme can be switched, and the sidebar is grouped by the kind of work instead of one flat list of nine. In the Seller panel, the shipping provider's brand no longer appears in any sentence a merchant reads. And every live prepaid bill is now read back from the payment gateway every fifteen minutes — observed, never acted on.",
    problem: "The Super Admin login was a small centred card with body-sized heading and a table-row-height button — the exact form the Seller login had measured and abandoned a month earlier. Below tablet width the shell hid its sidebar and offered nothing in its place, so a phone had a header and no navigation. The saved dark theme could not be changed from inside the panel. A decorative gradient card and a redundant badge both said 'Platform' where the header already did. Separately, nine merchant-facing strings named the courier aggregator, against a decision that is five months old.",
    solution: "The login became a split front door: display-scale heading, 44px fields and action, an error surface with an alert role, and a right panel that states how the panel is governed — rank re-read on every request, every merchant-affecting action logged, thirty-minute impersonation, password change revoking other sessions. The shell gained a controlled mobile drawer rendering the same grouped navigation as the sidebar, a theme toggle, and the operator's rank where the ornament used to be. The Seller panel reads one shared label, TokoΦ Kirim, wherever a provider name used to leak, guarded across every client-facing file. A new reconciliation loop asks the gateway's advice endpoint for each live bill and records the answer distribution on the cron card without settling anything, because the endpoint has been measured answering FAILED for bills that are still live.",
    verification: "Driven in Chromium at 360 and 1280 pixels: 21 of 21 claims, zero console errors — no horizontal overflow on any screen, one h1, 44px controls, keyboard order, the wrong-password alert, a real login, the drawer opening and closing on a tap, the theme flipping. Guards pin the drawer as controlled, the toggle present, the ornament absent, and the login shape; each was proved red against a mutation first. Production after deploy 537: the payment-advice sidecar is healthy and its first tick reported six bills asked, zero errors. The brand guard scans more than two hundred client files and named the exact file when the old string was put back."
  },
  {
    id: "v1.5.0-kelurahan-walk-va-fee-corrected",
    version: "v1.5.0",
    date: "2026-09-10",
    title: "Every Village Gets The Courier's Own Id, And The Buyer Stops Overpaying On Four Banks",
    category: "logistics_payment",
    surfaces: ["Logistics", "Payments", "Database & RLS", "Seller Admin", "Storefront"],
    summary: "The full courier subdistrict walk finished — 6.735 districts, no failures — and gave 74.017 of 78.764 villages the courier's own id, in both directions: the seller's pickup address and now the buyer's destination. The walk also exposed a matcher that produced WRONG ids rather than missing ones, which was fixed and re-run. Separately, the payment schedule was measured against the provider's own configuration again and a Rp500 overcharge on four virtual-account banks was closed.",
    problem: "Two id problems and one money problem. Our village ids are Kemendagri codes, not the courier's, so both kelurahan fields on a pickup request had to stay empty — the seller's since always, the buyer's because nothing produced one at all: the checkout collected a village to fill the postcode and the order API threw it away. Then the walk itself produced 125 courier ids each claimed by two different villages, because the matcher scored every row on its own and never marked a record taken, so sibling villages differing only by a numeral both took the same id — at most one of each pair can be right and nothing said which. And the fee schedule charged Rp3.500 on every non-BCA virtual account while the provider bills the platform Rp3.000, so the buyer paid Rp500 above cost on the cheapest method we offer.",
    solution: "The populator now claims a courier record exclusively, abandons a contested exact match on both sides instead of resolving it by file order, and awards a fuzzy match to the best name in the district so the loser goes unmatched rather than inheriting a neighbour's id; re-running only the 107 affected districts left zero duplicates. The destination half got its own columns and the id is re-derived on the server against the district the shipping was priced against — never taken from the request — and is omitted entirely when that district was itself a guess. The virtual-account default was lowered to Rp3.000 rather than adding four per-bank rows, because of the five banks the provider offers four are Rp3.000 and one is Rp6.500: none is Rp3.500, so a default matching no bank would have silently mispriced the next bank enabled.",
    verification: "The walk: 6.735 districts, 0 transport failures, 0 districts empty, 74.017 of 78.764 villages matched (93,97%) with all 4.747 blanks listed per row with their province. The repair changed 165 rows and left 0 duplicates, verified by a guard that pins the output rather than the matcher and was proved red against the committed duplicates first. The fee correction is the provider's own number, read live from its channel list on 2026-09-10: Rp3.000 fix for BNI, Permata, Mandiri and BRI, Rp6.500 for BCA — and the comparison guard that had recorded the divergence now asserts agreement. Release gate green: lint 0, guards 0, 169 files and 1.485 tests, RLS verified, storefront 8/8. Not proven: the courier has still never been called with a real subdistrict id, which needs one authorised production booking."
  },
  {
    id: "v1.4.0-kiriminaja-unblocked-autolaris-contract",
    version: "v1.4.0",
    date: "2026-09-09",
    title: "KiriminAja Unblocked, AutoLaris Read From Its Own Contract, And Two Wrong-Id Traps Caught",
    category: "logistics_payment",
    surfaces: ["Logistics", "Payments", "Super Admin", "Seller Admin"],
    summary: "Shipping quotes work in production again after the courier's IP allow-list was corrected, and the checkout total moved from Rp110.000 to Rp125.400 in a live browser drive. Both provider integrations were then read against their published specs rather than against our assumptions, which confirmed three things we had only measured, and caught two id defects before either could reach a real parcel or a real bill.",
    problem: "Ordering was impossible for two days: the courier answered every rate request with 401 naming our server IP, so no ongkir meant no COD and no order at all. Separately, the payment integration discovered which channels were live by creating one real bill per channel — its own comment admitted it created sandbox bills — and its answer was wrong, reporting OVO unavailable when the provider offers it. And the courier order id we generate is 28 characters while the courier's own tracking schema declares a maximum of 20.",
    solution: "The allow-list fix was the merchant's; what made it diagnosable was proving the credential was never at fault — a garbage key answers Unauthorized while ours answers the IP message, so authentication passes and the IP check runs after it. The channel probe now reads GET list_payment, one request, no bills. The webhook receiver keeps its closed gate but now logs the SHAPE of a rejected call — header present, scheme class, credential length, caller IP, candidate header names, never a value — so the first genuine rejection reveals what the courier actually sends. Two id traps were filed rather than papered over: our kelurahan ids are Kemendagri codes joined by name, not courier subdistrict ids, so sending them would be a wrong id rather than a missing one; and the 28-character order id is fixed at construction, never truncated at send time, because an id the provider stores truncated can never be looked up again.",
    verification: "Live in production: province 200 with 37 provinces, the public rates path 4 rates with COD enabled and the origin resolved to the seller's real pickup district, and a Chromium drive of the live checkout showing the total include Rp15.400 ongkir with zero console errors. Release gate green: lint 0 errors, verify:guards 0, test:release 165 files and 1447 tests, RLS 54/55, storefront 8/8. The payment reconciliation migration was deliberately REFUSED on evidence — the endpoint we used does not exist on our account and answers 404, while the documented replacement returns no decisive paid signal, so the settled-status list ships deliberately EMPTY and nothing can mark an order paid by guessing."
  },
  {
    id: "v1.3.0-release-gate-runnable",
    version: "v1.3.0",
    date: "2026-09-08",
    title: "The Release Gate Runs For The First Time, And 29 Queue Items Close",
    category: "major",
    surfaces: ["Seller Admin", "Super Admin", "Storefront", "Database & RLS"],
    summary: "Stage 7 had never been executed because three of its steps named commands that did not exist. Those commands were built and the gate ran: lint, the full release suite, four production builds, and six verification guards, all green. Twenty-nine queue items closed across two sweeps.",
    problem: "The development map disagreed with the code in both directions. Nineteen tasks carried no status at all, five super-admin epics were listed as open although they had shipped weeks earlier, the UI inventory called every super-admin route a mock, and the root status files told a reader the project was un-started. Underneath that, a confirmed delete left the row on screen, eight detail pages answered 500 instead of 404 on a malformed id, and eighty-two internal comments were being served to shoppers.",
    solution: "Every task now carries a status line naming the check that was run, and seventeen tasks were added for work nobody had filed. Four new guards make the gate real: an OpenAPI coverage check, a documentation-authority check, a requirement-to-evidence traceability check, and a source-size ceiling. On the product side: confirm dialogs on fourteen destructive screens with the dialog naming what truly happens, a shared isUuid on eight pages, honest per-courier returns that count unattributed orders separately instead of inventing a courier, a live courier health probe replacing a key-presence check that stayed green through the outage, and a shared rate limiter that survives a redeploy.",
    verification: "Stage 7: lint 0 errors, test:release 161 files and 1369 tests with RLS 54/55 and storefront 8/8, build:all four surfaces, verify:guards all green. Steps 4 and 6 are NOT met and are not claimed, so the gate stays partial. A stale-list defect was swept as a class by AST rather than patched twice: 9 broken memos across 6 screens, including tab counters frozen since first paint, proved causally by reverting one dependency and watching the row stay on screen for 8 seconds."
  },
  {
    id: "v1.2.2-tema-saldo-ux",
    version: "v1.2.2",
    date: "2026-08-24",
    title: "Tema Card Aspect, Landscape Gallery Dialog, And Saldo Day Folders",
    category: "feature",
    surfaces: ["Seller Admin", "Storefront"],
    summary: "The product CARD image ratio (1:1 / 4:5 / 2:3) joins the PDP gallery as a store-level Tema setting; the Galeri Produk dialog went landscape after the extra row pushed Simpan off-screen; and /saldo grew collapsible per-day folders on both the mutasi and penarikan lists, with long product titles clamped so they can no longer run into the price column.",
    problem: "The card surface had no aspect setup at all — T-10 locked every product image to 1:1 and the /tema dialog only governed the PDP gallery. Adding the second aspect row then made the portrait-stacked dialog taller than a laptop viewport, cutting the Simpan button off. On /saldo, a store doing hundreds of movements a day rendered one unbroken wall of rows, and a 100-character marketplace-style product name in the order detail overlapped the price cell.",
    solution: "cardAspect lives beside galleryAspect in stores.theme (merge-patch writers, resolveCardAspect degrades jsonb garbage to 1:1) and ProductCard maps it to LITERAL Tailwind classes read from Astro.locals.store — store-level on purpose, no per-template ratio prop, so one call site can never quietly opt out. The product-ratio-locked guard was WIDENED deliberately and mutation-proved red. The dialog body is two columns inside a wide DialogContent with a max-h scroll floor. Saldo day headers are clickable dropdowns carrying the day's count and net (payouts group on the request day), and detail titles are line-clamp-2 inside a flex-1 min-w-0 cell.",
    verification: "Full vitest 135 files / 1115 tests green; production-build browser drives: cardAspect 4:5 measured 296x370 = 0.800 exactly on the listing, the dialog saved 2:3 with font/tone surviving the merge-patch, the dialog measured 896x557 fully inside a 1366x768 viewport with Simpan visible, and the saldo drive on 841 real movements collapsed a day folder from 24 to 20 rows with zero JS errors. All probe rows deleted and flipped data restored exactly."
  },
  {
    id: "v1.2.1-ka-uat-autolaris-digital",
    version: "v1.2.1",
    date: "2026-08-24",
    title: "KiriminAja UAT Pack, A Hint-Only Webhook, And AutoLaris Digital Create Order",
    category: "logistics_payment",
    surfaces: ["Logistics", "Payments", "Seller Admin"],
    summary: "The pre-production-IP UAT KiriminAja asked for is executed and documented: 8/8 booking scenarios green on the sandbox, a webhook receiver live in production, and a measured sandbox defect reported to their team. AutoLaris payment creation moved to /api/h2h/submit with courir_id=1, so every payment appears in their CMS as a digital order.",
    problem: "KiriminAja's UAT sheet required create-order-to-pickup simulations across non-COD/COD, actual-vs-volumetric weight and insurance, plus a webhook callback URL — and no webhook receiver existed (tracking was poll-only). Probing also surfaced that the sandbox BOOKING validator ignores chargeable-weight scaling: every multi-kg booking at its own quoted price was refused with Ongkir tidak sesuai while the same 2 kg parcel was ACCEPTED at the 1 kg price. On the payments side the owner ruled AutoLaris is a gateway only, and their CMS detects a digital order solely from courir_id = 1 — the old create_payment endpoint could never appear there.",
    solution: "ops/kiriminaja-uat-sim.ts drives the nine scenarios through the product's own client; the webhook (api/public/kiriminaja/webhook) is HINT-ONLY exactly as the poller's design note prescribes — the unsigned payload only names order ids, and every fact comes from a verified tracking pull — behind a timing-safe fail-closed bearer check. alCreateOrder() implements the probed /api/h2h/submit contract (channel_code required, total = grand_total with the provider fee netting against settlement, payment instruction in payment_info) and all three payment creators switched; the callback accepts both id eras (trx_id and transaction_id).",
    verification: "8/8 bookings with OIDs recorded for the UAT sheet (filled PDF + DOCX delivered to Downloads); the sandbox defect is evidenced by OID 5758-E1kgprice150 (2 kg accepted at the 1 kg price). The webhook answered 401 to missing and wrong bearers ON PRODUCTION after deploy. A live production-build checkout drive through alCreateOrder produced a real VA on the sukses page with trx id 967290 and zero JS errors; the probe order was neutralized legally (payment failed, stock restored, order cancelled). Cancel scenario 9 waits on the sandbox issuing an AWB — their contract cancels by waybill, never order id."
  },
  {
    id: "v1.2.0-finance-overhaul",
    version: "v1.2.0",
    date: "2026-08-24",
    title: "Finance Overhaul — Global Subscription PPN Toggle, Enforced Fee Schedule, Seller Gets Goods Only",
    category: "major",
    surfaces: ["Seller Admin", "Super Admin", "Storefront", "Payments", "Database & RLS"],
    summary: "The money model is now one document (specs/docs/FINANCE.md) and one implementation: a global subscription-PPN toggle defaulting OFF, checkout fees enforced per the platform schedule, seller entitlement = goods omset + goods PPN only, and the marketing value every ad platform receives is the goods figure alone.",
    problem: "Subscription PPN was hardwired ON while the launch plan was a flat Rp275rb; payment fees existed only as display copy; and the seller's money leaked in both directions — the reporting view under-paid exclusive-PPN stores by their own tax while the LEGACY ledger arm credited payments.amount_idr, which contained shipping, so withdrawable balances carried the courier's money (the owner caught this on /saldo). Meta and TikTok also received the all-in total as the conversion value, inflating ROAS with shipping and admin fees.",
    solution: "platform_finance (single row, migration 0101) is the global toggle, read at invoice creation by all three creators and stored as invoices.tax_idr — the faktur renders the STORED tax, and with the toggle OFF the tenant panel shows no PPN caption at all. The fee schedule (COD 3% of omset+ongkir plus PPN on the fee, QRIS 0.7% of omset, VA per-bank flats) is enforced in /api/public/order and mirrored at checkout via each fee's own base field. Entitlement is ONE formula on every side — goods + added PPN − shipping debit for financials orders, greatest(subtotal − discount, 0) for legacy (migrations 0102/0104) — in the ledger credit, the entitlement view, and the analytics that ride it; advanced matching is always on and conversion value is goods-only across Meta, GA4 and TikTok.",
    verification: "Full suites green at every step (132-135 files, 1098-1115 tests, real Postgres money suites included); checkout fees reconciled to the rupiah per method in a production-build browser drive; the super-admin toggle driven ON and OFF with audit rows both ways and the flat display verified at zero PPN strings; migration 0101 confirmed applied on production with the toggle FALSE. The legacy correction ran against dev (195+2 rows) and production (155+2 rows, Rp3.420.360 of shipping out of the demo balances), and the sharpened ledger pin proves a 165k payment carrying 15k shipping credits exactly 150k."
  },
  {
    id: "v1.1.0-restricted-db-identity",
    version: "v1.1.0",
    date: "2026-08-22",
    title: "Restricted Database Identity Or Fail Closed — Two Pools, And Stage 4 Closed",
    category: "security",
    surfaces: ["Seller Admin", "Super Admin", "Storefront", "Database & RLS"],
    summary: "Merchant traffic now runs on a separate restricted PostgreSQL pool that proves its own identity before the first tenant query. Closes SEC-18 — the last open P0, so all 13 release blockers (Tasks 4.1 through 4.13) are done.",
    problem: "packages/db/src/client.ts resolved APP_DATABASE_URL ?? ownerUrl, so DATABASE_RUNTIME_ROLE=app fell back to the OWNER connection silently. Measured on production: all three app services carried the app label, none carried APP_DATABASE_URL, and the role they actually connected as was rolsuper = t, rolbypassrls = t. The restricted label had been in place since Task 2.1; the restricted identity never was.",
    solution: "Two named pools — db (owner) and appDb (restricted), whose only caller is withTenant(). In app-role mode the connected role is proved against pg_roles once per process, before the first tenant query, and the process exits if it cannot; DATABASE_RUNTIME_ROLE=app with no APP_DATABASE_URL now refuses to start. The runbook changed with the measurement: only admin moves to the restricted pool, because all 50 policies are TO PUBLIC and the surfaces that read outside withTenant would return zero rows.",
    verification: "npm test after a fresh install: 123 files, 1009 tests passed; astro check 0 errors on storefront (120 files) and landing (29); 16 mutations, 16 reds, two of which exposed real blind spots in the new guard. Post-deploy on production: pg_stat_activity showed tokophi 9 connections and tokophi_app 1 (its first ever), the admin container logged the identity gate passing, and tenant scoping under the restricted role returned 25 products and 1 store for batiknusantara."
  },
  {
    id: "v1.0.6-custom-domain-hsts",
    version: "v1.0.6",
    date: "2026-08-22",
    title: "Custom-Domain HSTS Raised To One Year",
    category: "security",
    surfaces: ["Storefront"],
    summary: "Merchant custom domains now answer max-age=31536000; includeSubDomains at the origin, matching the platform hosts.",
    problem: "Custom domains sat at max-age=86400 — the deliberate 24-hour ladder step taken on 2026-08-11 — while the .com and .id hosts had carried a year since 2026-08-07. Every fresh http:// visit to a merchant domain therefore kept a longer strippable window than the platform's own hosts did.",
    solution: "stsSeconds 86400 to 31536000 in the Traefik middleware tokophi-custom-hsts, hot-reloaded by the file provider with no restart and no deploy, pre-raise file backed up. preload stays off. SECURITY.md section 5 no longer carries this as an open decision and now states what includeSubDomains at a year commits a merchant to — every subdomain pinned to https, surviving their departure — so it can be said to them before their domain is attached.",
    verification: "Health was measured BEFORE the raise, not after: every host healthy on https (apex 200, www 301, valid certs), because a year-long pin over a host that cannot serve https is the one version of this that cannot be walked back. Re-measured immediately after on all four hosts — taniniaga.com, www.taniniaga.com, beautyinu.co, www.beautyinu.co — each answering max-age=31536000; includeSubDomains. Four hosts, not the three earlier notes claimed."
  },
  {
    id: "v1.0.5-stage5-wave",
    version: "v1.0.5",
    date: "2026-08-22",
    title: "Stage 5 Wave — Product Editor, Invitations, Payouts, CMS Pages And A Route-Entry Role Gate",
    category: "bugfix",
    surfaces: ["Seller Admin", "Super Admin", "Database & RLS"],
    summary: "Six Stage 5 tasks in one wave: 5.2 product-editor controls, 5.3 invitations, 5.10 payout compare-and-swap, 5.11 admin lint baseline, 5.16 CMS page bodies, 5.17 route-entry role gate on the control plane.",
    problem: "Screens kept promising what the database never did. Four product-editor controls never reached the payload, and Produk fisik NULLed the weight and dimensions that price every shipping quote. inviteStoreUser was read-then-write: 19 of 20 concurrent invitations threw users_email_unique out of the server action, which the dialog never catches, so the seller saw no toast at all over an operation that had in fact succeeded. markPayoutPaid accepted menunggu to selesai, stamping LUNAS on a withdrawal no operator had started transferring. updatePage and deletePage wrote blind. And no super-admin SCREEN had ever compared an operator rank — measured live, a support operator typing /pencairan was served the payout queue in full, including every merchant's bank account number.",
    solution: "Dead controls removed and barcode wired in both directions (5.2); both invitation inserts are now on conflict do nothing with returning, the reply is a discriminated union on outcome, and accepted_at is stamped by signIn rather than by the person doing the inviting (5.3); the payout transition moved into the UPDATE's own WHERE as a compare-and-swap in payout-transition.ts (5.10); both page writes return what they matched, with all three callers changed in the same commit (5.16); lib/route-roles.ts declares a rank floor per route group and platformRouteGate(path) is the first await of every platform page, additive to the mutation gates rather than replacing them (5.17); four prop-into-state effects converted to render-time adjustment (5.11).",
    verification: "Mutations proved red before anything was trusted green — 6 on the product-editor census, 8 on invitations, 6 on the payout transition, 9 on the route gate. npm test on the payout and route-gate branch: 119 files / 934 tests, exit 0 (937 after the related addStoreUser fix); the product-editor and invitation branches measured 118 files / 931 and 118 / 900 on their own bases. tsc 0 on admin and super-admin; lint 0 errors on both. The route gate was driven live across three ranks by eight route classes: support got 307 to /tiket on the dashboard, 200 on three routes, and the denial screen with zero privileged markers on the other four."
  },
  {
    id: "v1.0.4-credentials-out-of-urls",
    version: "v1.0.4",
    date: "2026-08-21",
    title: "Credentials Out Of URLs — One-Time Impersonation And A Header-Only Cron Gate",
    category: "security",
    surfaces: ["Super Admin", "Seller Admin", "Payments"],
    summary: "Tasks 4.11 (SEC-10) and 4.13 (SEC-16): the impersonation link became a single-use opaque exchange, and no reusable first-party secret rides a query string any more.",
    problem: "Buka Dashboard Seller minted a session-shaped JWT and put it in the query string. It was signed, audience-pinned and expired in two minutes — and reusable for every one of those 120 seconds, because a JWT is verified, never spent; the 7-day merchant session it exchanged for carried no mark that an operator was inside. Separately, CRON_SECRET travelled on the URL of every cron tick, so the credential authorising a state-mutating sweep across every tenant sat in the container command, in docker inspect, in the host process table and in every proxy access log; and payCallbackUrl() embedded the whole callback secret in every bill handed to the payment provider.",
    solution: "impersonation_grants (migration 0098) stores only the hash of a 256-bit opaque handle, and one UPDATE with consumed_at is null and expires_at > now() RETURNING is the entire security model. Membership, the merchant role, the operator row, rank and password rotation are all re-read at consume time; the session minted is 30 minutes and carries a signed operator identity that requireCapability writes into the audit log on every gated write, failing closed. Cron auth is now one shared header-only gate, and a request still carrying ?secret= is refused AND logged. The callback URL carries a per-payment signature bound to the row it resolved.",
    verification: "4.11: npm test 109 files / 834 tests, exit 0; 12 mutations, 12 reds; verify-migrations green at 99 entries, head 0098; verify-rls 53/54, so the new table is genuinely policed. 4.13: 112 files / 870 tests, exit 0; 14 mutations, 14 reds; the sidecar command was extracted from the compose file and run inside a real alpine:3.20 container against a probe server, which received the credential in the header and absent from the URL. The provider's own ?token= door is deliberately still accepted and logged as deprecated — refusing it would reject every genuine payment — so that half is not claimed as closed."
  },
  {
    id: "v1.0.3-money-audit-and-funnel",
    version: "v1.0.3",
    date: "2026-08-21",
    title: "The Money And Goods Audit, And Eighteen Days Of Rejected Ad-Funnel Orders",
    category: "bugfix",
    surfaces: ["Seller Admin", "Storefront", "Logistics", "Payments"],
    summary: "An audit pass over the money and goods paths shipped four fixes and reported a fifth finding that turned out to be a live outage: every order from /promo and /lp had been refused since 2026-08-03.",
    problem: "getBulkLabels joined payments unbounded, so one order holding a failed VA beside a collected COD printed two thermal labels for one waybill — one telling the courier to collect cash, the other saying it was already paid. updateFlashSale and deleteFlashSale reported success over an UPDATE that matched zero rows under RLS. A bulk resi run sliced at 50 with nothing carrying the remainder, so a seller selecting 150 orders was told 50 pesanan dibooking and left with 100 parcels never booked. The Penghematan Pelanggan tile summed discounts on cancelled orders. And OrderFunnel.astro — the component both paid-traffic funnels render — never posted a postcode, which the order API had made required on 2026-08-03.",
    solution: "The label query now uses the same correlated scalar subquery the other two payment-method screens use; both flash-sale writes return what they matched and both callers read it; the bulk result carries a skipped list with an honest ok and a toast naming the remainder; the savings tile excludes cancelled orders, with returns deliberately left in and the split pinned by a test. The funnel gained a required, always-editable Kode pos field with a stale-response guard, and its guard DERIVES the storefront's order forms instead of naming one file — the blind spot that cost eighteen days.",
    verification: "Every guard was proved red against the shipped code first: 3 of 4, 3 of 5, 2 of 3 and 2 of 3 tests respectively. The audit pass ran npm test at 113 files / 849 tests exit 0, storefront check 0 errors (119 files), landing 0 errors (29 files), tsc 0, lint 0 errors. The funnel fix measured 111 files / 844 tests with astro check 0 errors on both surfaces, and is recorded as not yet clicked in a browser — named rather than implied, because the change is browser-visible."
  },
  {
    id: "v1.0.2-kiriminaja-v62",
    version: "v1.0.2",
    date: "2026-08-20",
    title: "Booking Migrated To KiriminAja v6.2, And The Query Bug That Refused Paid Orders A Waybill",
    category: "logistics_payment",
    surfaces: ["Logistics", "Seller Admin", "Payments"],
    summary: "Shipment booking moved to the v6.2 pickup endpoint, verified with the one sandbox booking the owner authorised — which first required fixing two shipped query defects that were refusing waybills to orders that had genuinely been paid.",
    problem: "The v6.2 request contract had been mapped field by field, but the SUCCESS response was deliberately left unproven, because proving it means creating a real booking. The first two attempts never reached the courier API: the shipment action refused them for non-payment. Two causes, both in our own SQL. Postgres names an unaliased exists() expression exists, so two of them in one target list come back as a single column and the second value is lost; and drizzle renders a column interpolated into a sql template UNQUALIFIED, so eight correlated subqueries across three files compared a table to itself — which also blanked every line-item image on the order detail and collapsed the abandoned-but-not-yet-contacted count to zero for a whole store.",
    solution: "Both exists() pairs aliased, and the third still-correct site aliased too — patch the class, not the instance. The eight interpolations qualified by name, with a repo-wide guard for the class: a sql template that carries its own FROM must not interpolate a schema column. Then the booking itself: the endpoint path flipped, drop:false sent explicitly, and v6.2's empty-string awb normalised away — v6.1 answered null, and an empty string would have claimed a waybill the parcel does not have and sorted it to the back of the tracking poller's queue.",
    verification: "The authorised booking returned ok:true with a real order id and pickup number, made through the real seller path rather than the library in isolation, and its measured response body is committed as a fixture so nobody has to book again. Three mutations, three distinct failures. npm test 105 files / 800 tests for the booking pass and 104 / 794 for the scoping fix, tsc 0 and lint 0 errors on both. The repo-wide guard found the eighth interpolation site itself, in a file no manual reading had reached."
  },
  {
    id: "v1.0.1-pipeline-and-screening",
    version: "v1.0.1",
    date: "2026-08-20",
    title: "Delivery Pipeline And The Screening Sweep — CI, The Deploy Window, And Ten Findings",
    category: "minor",
    surfaces: ["Seller Admin", "Super Admin", "Storefront", "Database & RLS"],
    summary: "Between 2026-08-16 and 2026-08-20 the gates themselves were repaired: CI was red by construction, the deploy 503 window went from about 15 minutes to 81 seconds, and a screening sweep closed ten findings (A to J) alongside Tasks 4.9 and 4.10.",
    problem: "main's CI sat red from 2026-08-15 because the storefront verify step ran against the empty, never-migrated base database, and the seed step above it was a silent no-op that exited 0 — so CI could not have gone green on any commit, ever. Every deploy also held all three surfaces down for the whole demo-data chain. verify-migrations could not see a wrong stamp SCALE, and an index census found order_line_items.order_id declared in Drizzle but created by no migration and absent from the dev database AND production. The sweep itself found ten shipped defects, five of them writes that reported success while RLS clamped them to zero rows.",
    solution: "The verify step moved after the seed and was pinned to the test database, with template seeding and a browser added; the seed chain moved off the deploy critical path into its own service that nothing waits on; a pure migration-stamp module now refuses a wrong scale; migration 0096 created the missing index. From the sweep: setOrderStatus reports what it wrote, five blind writes now return what they matched, four dead controls were removed or honestly disabled (one had been persisting the wrong category), the manual invoice flip is documented as bookkeeping by owner ruling, and the AutoLaris status badge was removed because the column behind it gates nothing.",
    verification: "The whole CI job was executed by hand against a throwaway database, step for step — 11 steps, all exit 0, with the storefront suite going from fatal to 5 PASS and 1 documented SKIP. The deploy window was probed every 20 s from the second of merge: about 15 minutes, then 81 seconds (503 from +506 s to +587 s), then none observed at 15-second resolution — the doc records that as no 503 at that resolution, not as zero downtime. Test counts moved 96 files / 748 tests to 105 / 800 across the sweep, exit 0 throughout, and both lint gates were restored to 0 errors. GitHub Actions itself remains dead on a billing failure, which is an owner action nothing in the repository can substitute for."
  },
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
