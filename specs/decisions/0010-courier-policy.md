# ADR 0010 — Courier policy: a curated seller list, an SPX+JNE baseline, and per-origin availability

**Status:** accepted · **Date:** 2026-07-14 · Refines ADR 0004 (payments/shipping are platform-managed).
**Code:** `packages/lib/src/couriers.ts` (commit `c981498`).

## Context

ADR 0004 established that the platform owns the courier integration and the merchant only picks what to
offer. It did not say **which couriers a merchant may pick from**, so the answer defaulted to "whatever
the roster happens to contain" — and the roster is harvested, not curated:

- KiriminAja has **no list-couriers endpoint**. `kaServices()` prices ONE hard-coded reference route
  (Menteng → Coblong, 1 kg) and harvests the services out of the `shipping_price` response. The roster
  is only ever as complete as that single lane — TIKI never appeared in it, so no merchant could enable
  TIKI even if we wanted them to.
- The roster mixes couriers we want a seller to think about (SPX, JNE) with ones we do not (J&T Cargo —
  a freight product; instant/on-demand couriers, already out of scope).
- Measured on the sandbox 2026-07-14: a `shipping_price` call **without** a courier filter makes
  KiriminAja walk its whole roster — **5.513 ms / 18 services** — against **512 ms / 14 services** when
  the enabled couriers are named. The unfiltered call was paying seconds of checkout latency for rows it
  then threw away.

And one fact that invalidates the mental model behind a global on/off list:

> **Availability is decided per PICKUP ORIGIN, not globally.** Measured 2026-07-14: J&T quotes from
> Jakarta and Yogyakarta origins but **never from Gubeng (Surabaya)** — to any destination. "Enabled"
> does not mean "the shopper will see it".

## Decision

**1. `SELLER_COURIER_CODES` — a curated subset a seller may offer.**

```
spx · jne · jnt · lion · sap · sicepat · idx · anteraja
```

The Super Admin still sees everything KiriminAja carries (minus instant couriers, ADR-scoped out); a
seller sees only these eight. **J&T Cargo and TIKI are platform-only.** A merchant choosing between
fourteen near-identical services chooses badly, and each extra courier is a support surface we take on.
This is a **business decision**, so it lives in code, not in a database toggle someone can widen by
accident. A courier KiriminAja onboards later stays platform-only until it is added here deliberately.

**2. The baseline is `[spx, jne]` — and it binds only their STANDARD service.**

- **SPX is the primary.** It is the **COD rail** (the only courier with `codAllowed`, ADR 0004 / the COD
  gate) and the only courier that quoted on every route measured. Switching it off silently kills COD.
- **JNE is the backup.** It covers routes SPX does not serve. Switching it off leaves those routes with
  **no service at all** — a checkout with an empty shipping step.

**What is mandatory is the STANDARD (regular) service, not the whole courier.** Express and economy are a
seller's choice: a merchant may reasonably not want to offer next-day, and may reasonably not want to offer
a slow economy tier. What they may not do is leave a route with no ordinary way to ship on it.

| Courier | Service | `type` | `group` | Baseline? |
|---|---|---|---|---|
| SPX | SPX Standard | `1` | `regular` | ✅ **mandatory** (and the COD rail) |
| SPX | SPX Economy | `3` | `economy` | ⬜ optional |
| JNE | JNE Express **Reguler** | `REG23` | `regular` | ✅ **mandatory** |
| JNE | JNE Express **YES** | `YES23` | `next_day` | ⬜ optional (this is the express one) |

> ⚠️ **Match on `group`, never on the name.** JNE's *standard* service is called **"JNE Express Reguler"** —
> the word "Express" is in the name of the service that is **not** express. The genuinely express one is
> "JNE Express YES" (`group: "next_day"`). A name-based rule here will pick exactly the wrong row.
>
> **The baseline service = the `group: "regular"` service of SPX and of JNE.** `economy`, `next_day`,
> `one_day` and `cargo` are all optional.

**3. `PRIMARY_CHAIN = [spx, jne]`** — the preference order the checkout's first quote walks. The shipping
step opens by pricing the primary courier alone (`scope:"primary"`); the rest are priced only if the
shopper opens "Lihat kurir lainnya" (`scope:"all"`). Both paths go through the same `quoteShipping()`
that the order re-quotes with, so the two-step UI can never produce two prices.

**4. Both quote paths NAME the couriers they want.** Never call `shipping_price` unfiltered.

**5. Availability is per-origin, and surfaces must say so.** A courier that does not collect from the
seller's warehouse is simply absent from the quote. A green toggle on a courier that will never appear
for that seller's origin is a lie; the Jasa Kirim screen must state the enabled/available distinction
rather than imply that "enabled" means "offered".

## Consequences

- The seller's Jasa Kirim list is filtered by `isSellerCourier()`; the Super Admin's roster is not.
- **The baseline is enforced per SERVICE, not per courier.** The seller's Jasa Kirim card must lock the two
  `group:"regular"` rows (SPX Standard, JNE Express Reguler) and leave every economy / next-day / one-day /
  cargo row freely togglable.
- ✅ **Implemented service-level** (`5174189`): `BASELINE_SERVICES` = `spx:"1"` + `jne:"REG23"` (+ `isBaselineService`)
  in `packages/lib/src/couriers.ts`. `saveStoreServices` rejects a payload that drops a baseline **service**,
  and the Jasa Kirim card locks exactly those two rows — verified in a browser: 2 of 16 switches locked, SPX
  Economy and JNE YES switchable. `BASELINE_COURIER_CODES` remains as the courier-level answer to "which
  couriers are the primary/backup" (it drives `PRIMARY_CHAIN`), NOT as the lock.
  ⚠️ Match on the **`service_type`**, never on the name: JNE's standard service is called "JNE Express
  **Reguler**", and a name match is a trap waiting for a rename.
- Widening or narrowing the seller list is a code change in `packages/lib/src/couriers.ts` — deliberately,
  so it is reviewed.
- **This is OUR policy, not a courier limit.** KiriminAja marks JNE, SiCepat, Lion, Ninja and AnterAja
  COD-capable too; the SPX-only COD restriction rests on the (still **unverified**) belief that a refused
  SPX parcel returns free. See BACKLOG — "should COD be allowed on JNE" is an open question, and the
  answer is a data change (`platform_couriers.services[].codAllowed`), never a deploy.
- ✅ **Implemented since this ADR was written:**
  - `apps/admin/app/api/public/ongkir/route.ts` **imports** `PRIMARY_CHAIN` from `@tokophi/lib/couriers`
    (it briefly shadowed it with a local `["spx","jne","jnt"]` — two definitions of one policy is exactly
    what this ADR exists to prevent).
  - **The roster is now a UNION of four reference routes**, not one (`ROSTER_ROUTES` in
    `packages/lib/src/kiriminaja.ts`: two destinations from Menteng incl. a rural one, plus Surabaya and
    Yogyakarta origins). **TIKI is now visible to the platform** — it existed all along and one route
    could not see it.
  - **The per-origin coverage probe is BUILT** (`apps/admin/lib/courier-coverage.ts` → `kaCoverage()`):
    the seller's Jasa Kirim card now says whether a courier actually collects from *their* pickup
    address. **UNKNOWN is a first-class answer** — no pickup address, or a failed probe, renders no
    coverage state at all rather than a guess, and a failed probe is never cached as "does not collect".

## Alternatives rejected

- **Let the seller enable anything the roster carries.** That is what we had. It surfaced couriers that
  cannot be booked (TIKI was never even in the roster), a freight product (J&T Cargo) next to parcel
  services, and it let a seller switch off the COD rail without being told what that cost them.
- **Put the seller list in a DB table.** It would be a risk policy that any operator can widen with a
  click, with no review and no record of why. The COD chain already lives in data because it must be
  tunable per platform decision; the *roster a merchant sees* is a product decision and belongs in code.
