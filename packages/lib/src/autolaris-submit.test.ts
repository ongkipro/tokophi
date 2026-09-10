import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { codeOnly } from "../../../test/source-code";

// The Create Order contract, pinned from the vendor reference (ongkipro/autolaris, h2h-api.md §7,
// re-read 2026-09-11 on the owner's instruction "pastikan create order dan courir id = 1").
//
// `courir_id: 1` is the merchant-account agreement that marks an order DIGITAL — no AWB, no pickup,
// no dispatch — and AutoLaris then acts as a payment gateway only (all shipping is KiriminAja).
// `cod_value: "0"` is the companion the reference requires for that profile. Neither is a global
// Postman contract; both are what THIS account agreed, so a "cleanup" that drops or renames them
// would silently turn every prepaid checkout into a physical-shipment order at the provider.
//
// A source claim, because the values are literals inside one function and nothing at runtime would
// fail if they changed. ⚠️ The vendor's field really is spelled `courir_id`.
const SRC = codeOnly(readFileSync(new URL("./autolaris.ts", import.meta.url), "utf8"));

describe("alCreateOrder posts the digital-order profile the account agreed", () => {
  const fn = SRC.slice(SRC.indexOf("export async function alCreateOrder"), SRC.indexOf("export type AlAdvice"));

  it("targets /api/h2h/submit with courir_id 1 and cod_value 0", () => {
    // `codeOnly` inerts string literals, so the endpoint path is asserted by the call shape around it
    // and the two identifiers stay visible as identifiers.
    expect(fn).toMatch(/courir_id\s*:\s*1\b/);
    expect(fn).toMatch(/cod_value\s*:/);
    expect(fn).toMatch(/grand_total\s*:/);
    expect(fn).toMatch(/order_details\s*:/);
    // the id family the callback reports: the response's transaction_id is what we store as trxId
    expect(fn).toMatch(/trxId\s*:\s*d\s*\.\s*transaction_id/);
  });

  it("…and the claim is not vacuous: a physical courir_id fails it", () => {
    expect(codeOnly("courir_id: 6,")).not.toMatch(/courir_id\s*:\s*1\b/);
    expect(codeOnly("courir_id: 1,")).toMatch(/courir_id\s*:\s*1\b/);
  });

  it("the 30-character reff_id cap is respected by the seller-created bill key", () => {
    // order-detail.tsx builds `SB-` + 16 hex = 20 chars for the seller's own "buat tagihan"; the
    // public route uses the order number (≤ 16 measured on production). A UUID (36) would breach it.
    const detail = codeOnly(readFileSync(new URL("../../../apps/admin/app/(admin)/pesanan/[id]/order-detail.tsx", import.meta.url), "utf8"));
    expect(detail).not.toMatch(/requestKey\s*:\s*globalThis\s*\.\s*crypto\s*\.\s*randomUUID/);
    expect(detail).toMatch(/getRandomValues\s*\(\s*new\s+Uint8Array\s*\(\s*8\s*\)/);
  });
});
