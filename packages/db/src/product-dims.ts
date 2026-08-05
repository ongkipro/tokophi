// ── PARCEL DIMENSIONS FOR THE SEEDED CATALOGUE (N33) ─────────────────────────────────────────────
//
// 🔴 EVERY SEEDED PRODUCT USED TO DECLARE A 1 cm CUBE, in both seeders. It looked harmless because it
// never moved a price: KiriminAja bills the greater of the actual weight and the volumetric weight
// (`w × l × h ÷ 6`), and 1×1×1 is 0,17 g — the actual 150–300 g always wins. But the same three
// columns are what `createShipment` DECLARES TO THE COURIER when it books. The courier re-measures at
// pickup and bills the merchant the difference, so the seed shipped a demo whose every parcel is
// described to a real logistics partner as a one-centimetre cube.
//
// A placeholder that is PLAUSIBLE is worse than a blank: nothing warns, nothing looks odd on the
// screen, and the value is wrong on purpose. Wave 7 made the QUOTE read these columns too
// (`apps/admin/lib/shipping-weight.ts`), which is why `NEXT.md` N30 notes the fix "changes nothing on
// the seeded demo" — 1×1×1 cannot exercise the code path that exists to price a bulky-light parcel.
// With the numbers below it does.
//
// WHY A SHARED MODULE AND NOT A LITERAL IN EACH SEEDER: there are two seeders writing the same
// catalogue (`seed.ts`, 14 products; `seed-products.ts`, 10 more onto the live demo store) and both
// had `lengthCm: 1` written out by hand. One table means the demo cannot end up describing a blouse
// two different ways, and `product-dims.test.ts` can check that every handle either resolves or fails
// loudly — a silent default is how the 1 cm cube survived a year.
//
// ⚠️ THE NUMBERS ARE THE FLAT-PACK PARCEL, NOT THE GARMENT. An Indonesian fashion seller ships folded
// apparel in a polymailer, so what the courier measures is the packed envelope: a folded blouse is
// ~28×20×4 cm, a gamis is a much thicker fold, a hijab is nearly flat. They are believable, they are
// deliberately not precise, and they are the merchant's to correct in Produk → Pengiriman. What they
// must not be is a number chosen because it was cheap to type.

export type Dims = { lengthCm: number; widthCm: number; heightCm: number };

/**
 * Packed parcel size per garment kind, in centimetres. `volumetric` is `l × w × h ÷ 6` grams — the
 * number KiriminAja compares against the actual weight — and is quoted here so a future edit can see
 * what it is moving. The seed's variants weigh 150–300 g, so anything above ~300 g volumetric is the
 * figure the courier will actually bill, which is correct and is the whole point of N30.
 */
export const PACKED_DIMS = {
  hijab: { lengthCm: 20, widthCm: 15, heightCm: 2 }, //   100 g volumetric — nearly flat; actual weight wins
  blouse: { lengthCm: 28, widthCm: 20, heightCm: 4 }, //  373 g
  kemeja: { lengthCm: 30, widthCm: 22, heightCm: 5 }, //  550 g
  tunik: { lengthCm: 30, widthCm: 22, heightCm: 5 }, //   550 g
  rok: { lengthCm: 30, widthCm: 22, heightCm: 5 }, //     550 g
  celana: { lengthCm: 30, widthCm: 22, heightCm: 5 }, //  550 g
  khimar: { lengthCm: 28, widthCm: 22, heightCm: 5 }, //  513 g — jumbo, but jersey folds small
  piyama: { lengthCm: 30, widthCm: 24, heightCm: 6 }, //  720 g — two pieces
  dress: { lengthCm: 32, widthCm: 24, heightCm: 6 }, //   768 g
  jumpsuit: { lengthCm: 33, widthCm: 25, heightCm: 7 }, // 962 g
  cardigan: { lengthCm: 32, widthCm: 24, heightCm: 8 }, // 1.024 g — knitwear does not compress
  blazer: { lengthCm: 35, widthCm: 26, heightCm: 7 }, //  1.062 g — structured, must not be crushed
  gamis: { lengthCm: 35, widthCm: 26, heightCm: 7 }, //   1.062 g — the most fabric in the catalogue
} as const satisfies Record<string, Dims>;

export type GarmentKind = keyof typeof PACKED_DIMS;

/**
 * The packed parcel for a product handle. Both seeders name the garment first
 * (`dress-midi-bunga`, `blazer-formal-wanita-premium-slim-fit`), so the first segment IS the kind.
 *
 * ⚠️ THROWS on an unknown handle, deliberately. The alternative — falling back to some default — is
 * exactly the defect being repaired: a plausible number nobody chose, attached to a real parcel, with
 * nothing on any screen saying so. A seed that stops is a seed somebody fixes.
 */
export function packedDims(handle: string): Dims {
  const kind = handle.split("-")[0] as GarmentKind;
  const dims = PACKED_DIMS[kind];
  if (!dims) {
    throw new Error(
      `No packed dimensions for "${handle}" (kind "${kind}"). Add it to PACKED_DIMS in packages/db/src/product-dims.ts — ` +
        `do NOT fall back to a default: the booking declares these to the courier.`,
    );
  }
  return dims;
}
