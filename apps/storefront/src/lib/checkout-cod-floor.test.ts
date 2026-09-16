import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { codeOnly } from "../../../../test/source-code";
import { COD_FEE_MIN_IDR, COD_FEE_RATE, calculateOrderFinance } from "@tokophi/lib/order-finance";

// THE CHECKOUT'S COD PREVIEW MUST PRICE THE SAME PARCEL THE ORDER API WILL (Task 8.29).
//
// `/api/public/order` is the boundary and `calculateOrderFinance` is the engine; `checkout.astro`
// only MIRRORS the fee so the shopper sees the right number before pressing Bayar. A mirror that
// carries its own rate is how the two drift: the engine gained a Rp2.500 floor (KiriminAja's own
// minimum, T&C §5) and a mirror still computing `× 0.03` would show Rp1.500 on a Rp50.000 order
// while the bill says Rp2.500. Read as CODE (`test/source-code.ts`): a comment or a string that
// mentions the constant proves nothing.
const src = codeOnly(readFileSync(new URL("../pages/checkout.astro", import.meta.url), "utf8"));

describe("checkout.astro mirrors the engine's COD fee, floor included", () => {
  it("imports the rate and the floor from the engine and hands both to the inline script", () => {
    expect(src).toMatch(/import\s*\{\s*COD_FEE_MIN_IDR\s*,\s*COD_FEE_RATE\s*\}\s*from\s*"@tokophi\/lib\/order-finance"/);
    expect(src).toMatch(/const\s+COD_FEE_MIN\s*=\s*COD_FEE_MIN_IDR/);
    expect(src).toMatch(/const\s+COD_FEE_PCT\s*=\s*COD_FEE_RATE/);
    // The scanner emits the attribute as `define : vars = { { … } }`.
    expect(src).toMatch(/define\s*:\s*vars\s*=\s*\{\s*\{[^}]*COD_FEE_MIN[^}]*COD_FEE_PCT/);
  });

  it("codCharges() floors at COD_FEE_MIN and multiplies by COD_FEE_PCT — no literal rate, no literal floor", () => {
    expect(src).toMatch(/function\s+codCharges\s*\(\s*\)\s*\{\s*var\s+beforeVat\s*=\s*Math\s*\.\s*max\s*\(\s*COD_FEE_MIN\s*,\s*Math\s*\.\s*round\s*\(\s*\(\s*omset\s*\(\s*\)\s*\+\s*selectedShipping\s*\(\s*\)\s*\)\s*\*\s*COD_FEE_PCT\s*\)\s*\)/);
    // The old body must be gone — and the pattern below must be able to see it (mutation self-check).
    const old = /var\s+beforeVat\s*=\s*Math\s*\.\s*round\s*\(\s*\(\s*omset\s*\(\s*\)\s*\+\s*selectedShipping\s*\(\s*\)\s*\)\s*\*\s*0\s*\.\s*03\s*\)/;
    expect(src).not.toMatch(old);
    expect(codeOnly("var beforeVat = Math.round((omset() + selectedShipping()) * 0.03);")).toMatch(old);
  });

  it("the engine's floor is the courier's Rp2.500, on the same base the mirror uses", () => {
    expect(COD_FEE_MIN_IDR).toBe(2_500);
    expect(COD_FEE_RATE).toBe(0.03);
    const m = calculateOrderFinance({ subtotalIdr: 40_000, shippingListIdr: 10_000, paymentKind: "cod" });
    expect(m.codFeeBeforeVatIdr).toBe(Math.max(COD_FEE_MIN_IDR, Math.round(50_000 * COD_FEE_RATE)));
  });
});
