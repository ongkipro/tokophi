# Audit wave — tracking → money → auth → storefront · handoff

**Worktree:** `.claude/worktrees/promospec` · **Base at start:** `origin/main` @ `1e77668`
**Shipped as:** PR **#105, #107, #112, #114, #115, #116** — all squash-merged, all deployed and
verified in production by CONTENT (a string only the new build can emit), not by container health.

**Method that produced every finding below:** parallel read-only auditors, each given one dimension,
each told to verify against the live provider spec / a real browser / real SQL, and each told that a
wrong finding costs more than a missing one. Then a second round of auditors pointed at *my own merged
diff* with the instruction to find what I broke. That second round is where two of the worst defects
came from — see "What this session should teach the next one".

---

## Done

### Conversion tracking (#105, #107, #112)
- [x] `/pemasaran` feed card made actionable: "22 dari 25 produk terbit · 3 masih draf · 86 varian
      dikirim ke platform" instead of the same number printed twice.
- [x] `LandingLayout` had **no `MarketingPixels`** — `/promo/<handle>`, `/lp/<slug>` and `/thanks`, the
      pages a merchant buys traffic to, fired nothing at all. Fixed; and the funnel now sends
      `trackingCookies` and writes `lastOrder`, so it reports like the checkout does.
- [x] `/thanks` no longer carries the shopper's **name, WhatsApp and street address in the URL**
      (Meta prohibits PII in event params and reads the URL as `event_source_url`).
- [x] GA4 `value` excludes ongkir + PPN with `shipping`/`tax` as their own params; items carry
      `price`/`quantity`; the gtag event carries `send_to` so Google Ads stops counting every sale twice.
- [x] TikTok `contents[].price` is the item price, not the order total ÷ qty; browser phone hashed
      E.164 so it matches our own server; GA4 email Gmail-dot normalised.
- [x] `orders.channel` is written for the first time — it was hard-coded `"organic"` by its only writer,
      so every real store read Rp0 from ads forever while the demo showed a `Math.random()` split.
      **And the first fix was wrong:** `fbclid` is NOT paid-only (Meta appends it to organic links too),
      so it now reads `utm_medium` first and books a bare `_fbc` as `other`. 13 tests.
- [x] Cron reconciles every tick (`released` / `backfilled`) + 30-day retention on the delivery rows.

### Money in checkout (#114)
- [x] **Stock could go negative.** The `FOR UPDATE` gate ran per cart LINE, not per variant, and every
      check ran before any decrement — 6 in stock, a posted cart of 2 × qty 5, order committed for 10,
      row left at **−4**. Now aggregated by variant, locked in id order (also kills a deadlock).
- [x] **PPN was charged on the pre-discount subtotal** — a 50% voucher on Rp1.000.000 collected
      Rp110.000 where Rp55.000 was due, and wrote the wrong figure into `orders.tax_idr`, the faktur's
      base. Fixed server-side and in the checkout display together.
- [x] The success page rendered no discount line (so an order with free shipping showed arithmetic that
      did not add up) and its inclusive-vs-exclusive PPN test broke on any discount, flipping the label
      to "Termasuk PPN" on tax that had been added on top.
- [x] The gateway admin fee is named: the summary said Rp234.000 and the VA panel Rp238.000 six lines
      apart, so a shopper transferring the remembered number underpaid the VA and was never confirmed.
- [x] The COD-only ad funnel mirrors the platform COD cap + province allow-list instead of walking a
      shopper into a 403 after the whole form is filled, on a surface with no other payment method.

### Payments, ledger, billing (#114, #116)
- [x] 🔴 **In production, no prepaid payment could ever be confirmed.** All five builders of the
      AutoLaris callback URL built it bare; the endpoint authenticates on `?token=`/header and fails
      closed; the secret IS set on the live stack — so **every genuine callback was a 401**. One shared
      `payCallbackUrl()` now builds it. Measured against a production-mode server: bare **401**, with
      token **200**, wrong token **401**.
- [x] A late `PAID` callback stamped `dibayar` on a **cancelled** order (money collected, never
      credited, no refund path exists) — now refused and logged.
- [x] A replayed `EXPIRED` walked a **collected** payment back to `gagal` — money received is not
      un-received by a webhook.
- [x] `createOrderPayment` had no server guard against a second live bill on one order.
- [x] Super-admin "Gratiskan 1 bulan" **burned the Rp50rb first-month promo** (billing the merchant
      Rp249.750 too much as a side effect of a goodwill gesture); "Perpanjang trial" on a paying store
      deleted the period they had bought. Both fixed; and `run()` announced success even when an action
      refused.
- [x] `payments` had no index on `trx_id`/`reff_id`/`order_id` (migration **0085**).
- [x] A suspended merchant can fix the bank account their money pays into (it moves no money).

### Auth & tenancy (#114)
- [x] 🔴 **A session could not be revoked.** `role`/`storeId` were trusted from the 7-day JWT and nothing
      ever looked again — a demoted owner kept owner powers for the week, and resetting a compromised
      account's password ended nothing. `getSession()` re-reads `store_users` every request.
      Exercised in Chrome: demote → owner-only tab gated on the next request; remove → bounced to login.
      (First attempt LOOPED — middleware sees the valid JWT and sends `/login` back to `/` — hence
      `/api/auth/signout`, because only a route handler can delete a cookie.)

### Tests, tooling, docs
- [x] **Six ledger tests had been dead since migration 0081** (`mkVariantWithStock` never set
      `products.number`) and `describe.skip` hid it. Fixed — and a revived test immediately caught a
      **real production bug**: `dikirim → diproses` was missing from the state machine, so voiding a
      shipment on a dispatched order silently did nothing, leaving it stuck at "Dikirim" with no AWB and
      a poller that could never move it. **22/22 pass.**
- [x] `astro check` had been reporting 8 errors and typechecking **none** of the storefront's 92 files
      since 2026-07-22 (a JSX comment between `<header>`'s attributes). Now 0.
- [x] **16 migrations were unapplied on the shared dev DB** — `0062` aborted on a column that arrived via
      `push`, and drizzle runs a whole pending batch in ONE transaction. Made idempotent; all 86 apply.
- [x] Docs: `FLOWS.md` §8 (ad click → order → conversion, the flow that existed nowhere), `CODE_MAP.md`
      (the whole tracking stack was unfindable), `STATUS.md`, `SCHEMA.md` (the payload row claimed "no
      PII" while holding IP + UA), `DEPLOY.md`, `AGENTS.md` (this branch had **lost** the `## Docs` table
      and the "code wins" rule), ADR 0012 §9.4/§14.3 + ADR 0013 §7.2, `CHANGELOG.md`.

---

## NEXT: get a real prepaid payment confirmed end to end

Nothing below is blocked by code. **① and ② are for the owner and must happen first.**

- [ ] **① Reconcile against the AutoLaris dashboard.** Production shows **5 AutoLaris payments, ALL
      `menunggu`, none ever `berhasil`** — the exact fingerprint of the 401 bug. (The 56 `berhasil` rows
      are COD, which never touches the callback.) Also **7 subscription invoices `menunggu`, 3 older
      than 14 days**, and **5 non-comped stores past `current_period_end`**. ⚠️ **Our DB cannot tell
      "paid but we rejected the callback" from "nobody paid" — both look `menunggu`.** Only AutoLaris
      knows. Match the 5 `reff_id` + the 3 invoices there.
      *If any were paid:* the fix is NOT an `UPDATE`. It must run the same path as the callback so the
      ledger row, the order status and the held conversion all move — see ③. Writing to the production
      DB needs the owner's go-ahead.
- [ ] **② Ask AutoLaris two questions.** (a) Is there a **transaction status / inquiry endpoint**? Our
      client has only `create_payment`, `alProbeChannels`, `alTestConnection` — **no way to ask whether a
      VA was paid.** If one exists, the architecture stops depending on a webhook we do not control and
      becomes self-healing. (b) Do they **retry** callbacks, and for how long? That decides whether the
      5 stuck ones may still arrive on their own now the URL is fixed.
- [ ] **③ Super-admin "Konfirmasi pembayaran manual" for a prepaid order — the break-glass that does not
      exist.** Today **exactly one line in the whole codebase** writes `financialStatus = "dibayar"`, and
      it is inside the callback: when the webhook fails there is no button anywhere. Build it **through
      the same code path as the callback** (never a direct `UPDATE`), audit-logged like
      `setInvoiceStatus` already is. *Recommendation: auto stays the primary path, manual is the rem
      darurat — manual-only is slow and error-prone; auto-only is what just failed silently.*
- [ ] **④ Reconciliation view in super-admin:** payments `menunggu` older than N hours. This bug was
      invisible for weeks because no screen showed it. With this, the next one is caught the same day.
- [ ] **⑤ Prove it: one small real prepaid transaction.** The callback must arrive and the order must
      become `dibayar` on its own. Everything so far is a measurement, not a live confirmation.
- [ ] **⑥ Polling** (only if ② says yes) — a cron that asks AutoLaris the status of every `menunggu`
      payment. Removes the single point of failure entirely.

### Owner decisions still open (recorded in `BACKLOG.md`, deliberately not taken)
- [ ] **No consent layer anywhere in the repo** — `fbq`/`ttq`/`gtag` bootstrap in `<head>` before any
      interaction. For ID-only traffic that is a defensible business decision; for one EU/UK visitor it
      is the merchant's liability, and they cannot comply because we ship the tag.
- [ ] **PPN and the feed price** — Google requires tax-inclusive outside US/CA; our feed is exclusive and
      the storefront displays the same ex-PPN number, so fixing the feed breaks the landing-page match.
      Latent: zero stores have `tax_enabled`. The cheap half is warning the merchant when they tick it.
- [ ] **Every feed image is WebP**, which Meta and TikTok document as unsupported (Google accepts it).
      Needs a second rendition format — a storage decision, not a feed edit.
- [ ] **May a SUSPENDED merchant withdraw revenue they already earned?** The code argues both sides.

### Engineering debt with measurements (see `BACKLOG.md` for the numbers)
- [ ] 20 React Compiler lint errors — `npm run lint` is a gate **nothing runs** (`next build` does not,
      there is no CI). Includes a `Date.now()` in a CLIENT render path.
- [ ] Storefront a11y: no `aria-live` anywhere on the checkout, errors not associated via
      `aria-describedby`, no combobox semantics on the address cascade, unlabelled variant groups,
      10 × 6 px hero dots, 3.54:1 hero body copy.
- [ ] Perf: seeded imagery excluded from `srcset` (~600 KB of the homepage's 821 KB); 57–109 KB of
      inline script re-sent uncacheably per navigation.
- [ ] A refused COD parcel (`retur`) stays a reported Purchase for ever — no refund/cancellation event
      is emitted to any provider, so ROAS is structurally overstated by the COD refusal rate.

---

## What this session should teach the next one

1. **A green build proves nothing about the thing you changed.** The payment webhook, the missing
   layout, the dead `astro check` and the 16 unapplied migrations were all green.
2. **The dev environment hid the two worst bugs.** With no `AUTOLARIS_CALLBACK_SECRET`, dev accepts an
   unauthenticated callback — so the 401 path was never exercised locally. With no `TEST_DATABASE_URL`,
   the ledger suite skips — so six broken tests reported success. **Ask what your environment is
   letting you not find out.**
3. **I was wrong twice, confidently.** `fbclid` as a paid-click marker (Meta appends it to organic links
   too) and `rel.length` as an UPDATE row count (it is 0 without `RETURNING`). Both passed review, build
   and the tests I wrote myself. What caught them was an auditor pointed at my own diff and told to find
   my mistakes — and checking the vendor's actual documentation instead of trusting recall.
4. **Fixing a lie can install a better-dressed lie.** `orders.channel` went from "always organic" to
   "counts organic Instagram traffic as ad revenue" in one commit. When you make a number real, ask what
   it will now over-report.
5. **Skipped tests are worse than missing ones** — they report green while proving nothing, and one of
   these had been hiding a production bug for over a week.
