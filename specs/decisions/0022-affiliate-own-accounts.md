# ADR 0022 — Store affiliates get their own accounts at affiliate.tokophi.com

**Status:** Accepted · **Date:** 2026-11-14 · **Decided by:** the owner, 2026-11-14 ("jangan jadikan satu dengan
user belanja"; login email + password; the seller pays the commission outside TokoΦ; the seller turns the
programme on per store). **Task:** AFFILIATE-P2 (`specs/docs/TASKS.md`).
**Supersedes:** `specs/AFFILIATE_SPEC.md` F-A15 as written in v1.2 ("the affiliate's identity is the buyer
Akun TokoΦ") — F-A15 now reads as below. **Amends:** ADR 0016 (dated note there: the buyer account no longer
carries an affiliate area). **Not ported:** the proposed "affiliate commission paid from the seller balance"
ADR of PR #424 (numbered 0018 there; 0018 is taken on main) — recorded below as a future option only.

## 1. Context

The store affiliate programme (`specs/AFFILIATE_SPEC.md`) was built on the never-merged PRs #424 / #430 / #431 /
#455. Its identity model made an affiliate's sign-in the buyer "Akun TokoΦ" (`apps/account`, Google sign-in,
ADR 0016), so one person's shopping history and their affiliate earnings lived behind one account. The buyer
account then shipped on its own (#471, migrations 0121–0124, dormant), and on 2026-11-14 the owner decided the
two must NOT be one account: a reseller or creator promoting shops is a different relationship with the
platform than a shopper, and tying them together drags buyer-account consent, Google-only sign-in and UU PDP
scope onto a business relationship that needs none of it.

## 2. Decision

1. **A separate identity.** Affiliates sign up and sign in at **`affiliate.tokophi.com`**, a new app
   `apps/affiliate` (Astro SSR, Node adapter — the `apps/account` shape: own Dockerfile, `/healthz`, compose
   service with a Traefik `Host()` router at priority 100 over the store wildcard, `security.allowedDomains`,
   CI job `build · affiliate`; slug `affiliate` reserved like `account`). Tables `affiliate_accounts` and
   `affiliate_sessions` (migration `0125`) are platform-level (no `store_id`, RLS on with no policy). Nothing
   references `buyer_accounts` / `buyer_sessions`, and `apps/account` gets no affiliate page.
2. **Email + password.** The password is scrypt `salt:hash` through `@tokophi/lib/password` (the Seller's
   format; `verifyPassword` moved beside `hashPassword`). The door reuses the Seller login's brakes: per-IP
   `rateLimit` in the fail-closed `login:` / `signup:` buckets, a per-account failure streak (`LoginSurface`
   `affiliate`) checked before the password, one `platform_activity` row per burst. The session is an opaque
   32-byte token in an HttpOnly, Secure (production), SameSite=Lax, host-only cookie `tphi_affiliate`; only its
   sha256 is stored, the row decides every request (revoked / expired / disabled ⇒ signed out). Changing the
   password revokes every other session. **There is no password reset by email** — the platform has no mail
   provider; the UI says to contact the seller or support. No Google sign-in.
3. **One account, many stores.** A store's affiliate stays a per-store `affiliates` row the merchant approves;
   `affiliates.account_id` links it to the account (`UNIQUE (store_id, account_id)`). It is bound ONLY by
   (a) applying while signed in (`/gabung?toko=<slug>` — the account's own name and phone, 5 attempts per
   account per hour counted in `rate_limit_counters`, a same-phone row without an account is never taken
   over) or (b) accepting the seller's invitation (7 days, single use, sha256 stored, ONE conditional UPDATE
   binds it). Never by email or phone match. Another account's row answers like an unknown id (404).
4. **The seller pays outside TokoΦ.** TokoΦ records one commission per attributed order, frozen at order time;
   the seller transfers the money themselves and clicks "Tandai dibayar". Nothing touches `ledger_entries`,
   `payouts` or the seller balance.
5. **The seller switches it on.** `store_settings.affiliate_enabled` (default false) — Seller → Pengaturan →
   Affiliate, capability `affiliates:write` (owner / admin / advertiser). No Super Admin gate.
6. **Dormant by default.** One variable, `AFFILIATE_APP_URL` (the app's own origin), is the switch on all three
   surfaces: unset ⇒ `affiliate.tokophi.com` answers one 503 "belum dibuka" page (`/healthz` stays 200), the
   Seller's invite button is hidden, and the storefront's `/affiliate` says applications are not open. The
   compose default is empty.
7. **The storefront has no anonymous form any more.** `<store>/affiliate` (404 while the programme is off)
   links to `affiliate.tokophi.com/gabung?toko=<slug>`. Attribution is unchanged from the old code: `?ref=CODE`
   (30 days, last click, captured client-side) or a code typed at checkout, resolved by `/api/public/order`
   inside the order transaction (typed beats ref, a bad code never costs the sale, self-referral by phone
   refused, programme off = no commission).

## 3. Consequences

- The 2026-10-29 audit gaps close in the schema: `UNIQUE (store_id, phone)`, `CHECK commission_idr >= 0`, and a
  composite FK `(affiliate_id, store_id) → affiliates (id, store_id)`. The phone-enumeration oracle of the
  public form is gone with the form; the signed-in apply answers one non-specific message for "taken phone"
  and "no code", is rate-limited per account, and uses the account's own phone (probing a number costs a new
  account, itself rate-limited per IP).
- Sign-up answers "email sudah terdaftar" — the same enumeration every sign-up form (the Seller's too) has.
- A forgotten password needs a human until a mail provider exists (follow-up task).
- An affiliate who also shops has two accounts. That is the owner's intent.

## 4. Future option (not decided)

**Deducting commissions from the seller balance** (PR #424's proposed ADR): the platform would book a ledger
debit per commission and pay affiliates itself. It needs a payout rail to affiliates, KYC, and tax handling —
out of scope here; recorded as a follow-up in TASKS.md.

## 5. Alternatives rejected

- **Same account as the buyer (AFFILIATE_SPEC v1.2 F-A15).** Reversed by the owner on 2026-11-14.
- **Keep the anonymous storefront form.** It was the enumeration oracle, and affiliates could never see their
  own commissions; the account is now the way in.
- **Google sign-in for affiliates.** Owner chose email + password; Google would re-couple the identity to the
  buyer account's OAuth client and redirect-URI switch.
