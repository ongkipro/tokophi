# Session handoff — N17: a module in the wrong app is a feature that cannot exist

**Date:** 2026-08-03
**Branch:** `feat/cart-recovery-link`, based on `origin/main` @ `2399ea5` (after audit wave 2, `#129`)
**Closed:** **N17** — the abandoned-cart recovery link (P1, was sized **L**)
**Gates:** `tsc` clean · `astro check` 0 errors · `eslint` clean on every touched file · `npm run test:db`
**25 files / 197 tests passed** (includes the 22 DB-coupled money tests)

---

## The finding, which is bigger than the fix

`signRecoveryToken` was correct, well-commented, security-reviewed — and had **zero callers in all four
apps** for the entire life of the feature. Not because anyone forgot to call it, but because of **where
it lived**:

```
apps/storefront/src/lib/recovery.ts     ← the MINT lived here
apps/admin/…                            ← the only surface that lists abandoned carts lives here,
                                          and it CANNOT import from apps/storefront/src
```

The admin is the surface that shows Keranjang Ditinggal and opens the WhatsApp message. It physically
could not reach the function it needed. So:

- the merchant's WA message carried `{nama, produk, toko}` and **no way back to the cart**;
- ~50 lines of storefront code — `verifyRecoveryToken`, the "Selamat datang kembali" banner, the basket
  restore, the field pre-fill — were **live and unreachable**;
- **nothing failed.** No error, no red test, no broken build. A shopper who got the message simply did
  not come back, which is indistinguishable from a shopper who changed their mind;
- **four docs recorded it as working** (`REQUIREMENTS.md` SEC-13, `UI_INVENTORY.md`, `CODE_MAP.md`
  "mints/verifies", `STATUS.md`). Audit wave 2 corrected them to *"VACUOUSLY MET — no link is ever
  minted"*; they are corrected again now that one is.

**The generalisable rule: a module's location is part of its contract.** If the caller cannot import it,
the code is decoration. `packages/lib` exists for exactly this and the pair belongs there.

## What shipped

| | |
|---|---|
| `packages/lib/src/recovery.ts` | the pair, moved. `jose` **declared** as a dependency of `packages/lib` rather than relied on via workspace hoisting — it worked by accident of hoisting before, which is a phantom dependency |
| `apps/storefront/src/lib/recovery.ts` | now a one-line re-export, so `checkout.astro` is untouched |
| `getStorefrontHost()` (`admin/lib/data/store.ts`) | the canonical host: **active primary** custom domain, else `<slug>.<base>` |
| `getAbandonedCarts` | mints **per cart that has a phone**, on `sessionId` |
| `cartMessage` → `admin/lib/cart-message.ts` | split out as a **pure** module; appends the link when the template has no `{{link}}` |

Three decisions worth keeping:

- **Mint only where there is a phone.** No phone means no WhatsApp to send it on, and a token is a
  credential — do not create ones nobody can use.
- **`sessionId`, not `r.id`.** The storefront looks the row up by `session_id`; the primary key would
  mint a token that verifies perfectly and then matches no row — a link that opens an empty checkout
  with nothing anywhere saying why.
- **`status='active'` on the domain is load-bearing.** A `pending`/`provisioning` domain has no cert and
  does not answer; a link pointing there is a TLS warning, not a recovery.

## ⚠️ Two traps found while doing it

**1. `{{link}}` was deliberately KEPT OUT of the seed** — and the queue's own step 3 suggested adding it.

The same `keranjang` `wa_templates` body is rendered by three CRM screens (`crm/page.tsx`,
`followup-client.tsx`, `pipeline-client.tsx`) which work from `followups` rows. Those rows have **no
checkout session**, so they cannot mint a link — and `fillTemplate` leaves an unknown token **verbatim**.
Seeding the placeholder would have sent the literal string `{{link}}` to a real customer.

So: no seed change, `cartMessage` appends instead, and those three now pass `link: ""`. The append also
solves the problem the seed never could — **the seed is not a migration**, so a placeholder reaches new
stores only, and substitution alone would have shipped a fix that changed nothing for a single live
merchant.

**2. `CHECKOUT_RECOVERY_SECRET` must be set on BOTH surfaces or neither.** The admin and the storefront
resolve it independently (falling back to `AUTH_SECRET`). A mismatch does not error — every minted link
just fails to verify, and the shopper lands on a normal empty checkout. Recorded in the module header and
in `BACKLOG.md`.

## Verified end to end, in a browser

Not inferred from the code, and not from a build being green — the AC demanded a real message body and a
real restore, because **the restore path had never been run in a browser at all**.

1. Logged in to the Seller admin (production build, seeded owner) → `/pelanggan/keranjang`.
2. Read the **real** `wa.me` URL the "Hubungi via WA" button opens. Its `text=` payload:

```
Halo kak Fajar Nugroho 👋, produk *Gamis Syari Polos* masih ada di keranjang. Mau saya bantu proses
sekarang? Stok terbatas ya kak 😊 — Batik Nusantara

Lanjutkan pesanan di sini:
https://toko-demo.test/checkout?r=eyJhbGciOiJIUzI1NiJ9...
```

3. Followed **that exact link** on the storefront:

```
banner : Selamat datang kembali, Fajar! Keranjang dan datamu sudah kami simpan — tinggal lanjut bayar.
nama   : Fajar Nugroho
wa     : 08123001028
cart   : 1x Gamis Syari Polos
sid    : ck-aktif-0          ← the SAME session id, so the cart joins its own journey
```

The host came from the **active primary custom domain** (`toko-demo.test`), not the `<slug>.<base>`
fallback — so the branch that matters was the one exercised. On a second cart the restored subtotal was
**Rp 1.095.000**, matching `checkout_sessions.subtotal_idr` exactly.

**Refusals, also driven:** a token minted for another store, a tampered signature, and junk all render
the normal empty checkout — banner absent, no 500.

**The shared dev DB was left untouched**: the WA button was never *clicked* (that would write a
`followups` row), the link was read from the RSC payload instead. Confirmed after: 796 `ditinggal` rows
unchanged, zero new `keranjang` follow-ups, both test sessions still `ditinggal` with their original
timestamps.

## The guards left behind

Each fails on something silent:

```bash
npm run test:db
```

- **`packages/lib/src/recovery.test.ts`** — round trip, store-binding, tampered signature, junk (never
  throws), and that the URL survives `encodeURIComponent` + the query split.
- **`apps/admin/lib/recovery-wired.test.ts`** — **the mint has a caller.** This is the one that would
  have caught the original bug, and no unit test could: both halves pass their own tests in isolation;
  what was missing was the *wire*. Confirmed it fails against `origin/main` (zero `recoveryUrl` mentions).
- **`apps/admin/lib/cart-message.test.ts`** — the append-vs-substitute rule, and that a literal
  `{{link}}` can never reach a customer.

`cartMessage` was moved to a pure module to make that last one possible — importing it from
`lib/data/checkout.ts` demanded a live `DATABASE_URL` for a function that only does string substitution.
Same split as `platform-rank.ts` and `temp-password.ts`, for the same reason.

## Docs corrected (again)

`REQUIREMENTS.md` SEC-13 · `STATUS.md` · `UI_INVENTORY.md` · `CODE_MAP.md` · `DATA_MODEL.md` ·
`BACKLOG.md` · `NEXT.md`. Each now says the link is minted **and** carries the reason it was not, because
the failure mode — a module the caller cannot import — will otherwise be re-created by the next move.

## NEXT

- **N18** (`tempPassword()` 24 bits + no login rate-limit) — the next unblocked security item. ⚠️ It
  touches `super-admin/lib/temp-password.ts`, created by `#129`; check for concurrent work first.
- **N19** — `seed:recent` inserts no `checkout_sessions`, so a real 30-day window holds **4 carts, of
  which 1 has a phone** (measured today; the entry says 7). The recovery feature is now real but nearly
  invisible on the demo. Insert-only + idempotent, like the rest of that script.
- **N2** — still not done; still owner-blocked.
