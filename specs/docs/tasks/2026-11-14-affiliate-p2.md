# AFFILIATE-P2 — store affiliate programme with affiliates' own accounts (2026-11-14)

Owner decisions of 2026-11-14 (recorded in ADR 0022): affiliates get their OWN account, separate from the buyer
account ("jangan jadikan satu dengan user belanja"), at `affiliate.tokophi.com`; login = email + password; the seller
pays commissions outside TokoΦ; the seller turns the programme on per store.

## What was ported, and from where

| Source | Taken | Changed |
|---|---|---|
| #424 `0116_store_affiliates`, `0117` affiliate half, #455 `0122` index | tables, enums, columns, RLS | renumbered to ONE migration `0125`, stamp `1787600004000`; `account_id` → `affiliate_accounts` (new), not `buyer_accounts`; + UNIQUE `(store_id, phone)`, CHECK amounts ≥ 0, CHECK source, composite FK, CHECK rate/hold ranges |
| #424/#431 Seller actions, data, attribution, mask, rate parsing | as is (+ #431 validation) | invite URL → `AFFILIATE_APP_URL/undangan`; duplicate-phone message; new `setAffiliateProgramEnabled` / `getAffiliateProgramEnabled` |
| #430 visibility | sidebar badge, commission chip on Pesanan, detail card, `commission-state.ts` | none |
| #424 `apps/account` affiliate pages | data layer + page flows | moved to the NEW `apps/affiliate`, re-keyed to `affiliate_accounts`; own small stylesheet instead of the 3k-line prototype CSS |
| #424 storefront `/affiliate` form | — | **removed**: the page links to the affiliate app (or says "belum dibuka"). Simpler and honest: no anonymous write, no phone oracle. |
| #424 proposed ADR "commission paid from seller balance" | — | not ported (owner chose "seller pays outside"); follow-up task |

## Decisions the owner may want to revisit

1. **The application uses the ACCOUNT's own name and phone** (not free fields), so a "same phone already in this
   store" refusal can only be probed by registering one account per phone number. The refusal message is the same
   for "phone taken" and "no code could be made".
2. **Storefront `/affiliate` without `AFFILIATE_APP_URL`** shows "Pendaftaran affiliate belum dibuka" (no public
   form). Commissions still work for affiliates the seller adds by hand while the app is dormant.
3. **Programme switch lives in two places**: Pengaturan → Affiliate (the owner's requested home) and the
   Affiliate screen's own Pengaturan tab (with rate + hold days). Same column, same capability.
4. **`affiliates:write`** = owner, admin (by subtraction), advertiser — same as #424.
5. **Sessions**: 30 days fixed from sign-in; password change revokes every other session; no "sign out other
   devices" list (YAGNI for v1).
6. **Failed-login audit** rows go to `platform_activity` (kind `admin`, store null) with the label "Affiliate TokoΦ".
7. **Sign-up reveals "email sudah terdaftar"** — same as Seller sign-up; accepted.
8. **`verifyPassword` moved** into `@tokophi/lib/password` (admin re-exports it); super-admin keeps its own copy
   (untouched, out of scope).

## Not done

Password reset (no mail provider), F-A16 notifications, F-A11/F-A13/F-A14/F-A17, balance-deduction payouts — see
`specs/docs/TASKS.md` AFFILIATE-* follow-ups.
