# N33 — product dimensions backfilled on PRODUCTION and dev · EXECUTED 2026-08-05

**Owner-authorised.** Script: [`ops/tokophi-n33-product-dimensions.sql`](../../../ops/tokophi-n33-product-dimensions.sql)
— run unmodified, piped through `sed 's/^rollback;.*/commit;/'`. **The file in the repo still ends in
`rollback` and was never edited.** Verified after both runs.

## What ran, in order

| step | production | dev (`tokophi-db`) |
|---|---|---|
| ① counts read first | 1 store `batik-nusantara`, 25 products: **24 cubes, 1 NULL** | 24 products, **24 cubes, 0 NULL** |
| ② dry-run (file as-is, ends `rollback`) | `UPDATE 24`, still_cube **0**, unmatched handles **0** | `UPDATE 24`, still_cube **0**, unmatched **0** |
| ③ real run (`commit`) | `UPDATE 24` · **COMMIT** | `UPDATE 24` · **COMMIT** |
| ④ independent re-query | still_cube **0**, null **1**, total **25** | still_cube **0**, null **0**, total **24** |

Production connection: `ssh root@45.77.33.112` → `docker exec $(docker ps --format '{{.Names}}' |
grep -m1 '^postgres-')`. **Resolve the container by prefix** — the hash suffix changes every deploy.

Per-kind result on production (sample): `dress 32×24×6` ×3 · `blazer 35×26×7` ×2 ·
`blouse 28×20×4` ×2 · `celana 30×22×5` ×2 · `gamis 35×26×7` ×2 · `jumpsuit 33×25×7` ×2.

### One difference from the script's own recorded dry-run — expected, not a fault

The header records `rows with any dimension NULL — 0 (before and after)` from a **dev scratch copy**.
Production has **1 NULL row** (`kefir-collagen-soap-60gr`). It was NOT touched, and that is correct:
the `WHERE` requires `= 1` on all three axes, and the script says so explicitly — *NULL means
"unknown", the booking's `?? 10` fallback already handles it, and inventing a size for a product we
have never seen is the defect this file repairs, not a fix.*

## ⚠️ The script's stated consequence did NOT happen — measured, not assumed

The header claims *"the ongkir on the demo store goes UP, correctly"*. **It did not.** Quoted live on
production after the commit, Yogyakarta → kecamatan 5788, one item:

| cart | dims | SPX Standard | JNE Reguler | JNE YES |
|---|---|---|---|---|
| soap (NULL dims — no volumetric possible) | — | Rp14.000 | Rp19.000 | Rp26.000 |
| gamis (500 g actual) | 35×26×7 | Rp14.000 | Rp19.000 | Rp26.000 |

**Identical.** The reason is arithmetic, and it is worth writing down because the next person will
otherwise re-run this expecting a change:

- the packed dims imply **35 × 26 × 7 ÷ 6 = 1.062 g** volumetric;
- `MIN_BILLABLE_GRAMS = 1000` already floored every quote at 1 kg
  (`apps/admin/lib/shipping-weight.ts:36`);
- couriers round at **0,3 kg** (`03-important-notes/01-service-list.md`), so 1,062 kg rounds **down**
  to the same 1 kg tier as the floor.

So for a single garment the backfill is **price-neutral**. That does not make it pointless — the value
delivered is the other half of the defect: **`createShipment` now declares a truthful parcel to the
courier**, so the re-measure at pickup no longer produces a surcharge the merchant silently absorbs.
The Rp41.100 gap N30 measured came from a 40×30×20 parcel, which *does* cross tiers; these garments do
not.

## 🟠 Found while verifying — parcel size does NOT scale with quantity

`maxDims()` (`apps/admin/lib/shipping-weight.ts`) takes the **largest value per axis** across cart
lines, and `createShipment` books the same way. So a cart of **five gamis** still declares one
garment's parcel — 35×26×7 — while the actual weight grows to 2,5 kg. The weight side is right; the
volumetric side is frozen at a single item.

This is the documented rule and it is deliberate (quote and booking must agree), so it is **not a
regression** — but it means volumetric can only ever dominate on a *single* bulky item, and a
multi-item order is exactly when a real parcel gets bigger. **Nobody has filed this.** Worth a
decision: sum a dimension, scale the smallest axis, or accept it and say so in `KIRIMINAJA.md`.

## What is now true

- `products.length_cm/width_cm/height_cm` carry the folded-polymailer size on every seeded product,
  **on production and on the shared dev DB**, which now agree.
- One production product (`kefir-collagen-soap-60gr`) keeps NULL dimensions — honest, and the booking
  falls back to `?? 10`.
- The seed side was already fixed in #150 (`packages/db/src/product-dims.ts`, throws on an unknown
  handle), so new products do not reintroduce the cube. **Keep the SQL's table and `product-dims.ts`
  in step if either changes.**
- `ops/tokophi-n33-product-dimensions.sql` stays as it is — `rollback`, unexecuted-by-default. Re-run
  it any time to *read* the counts; it is safe as written.
