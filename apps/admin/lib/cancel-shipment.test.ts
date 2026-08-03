import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { codeOnly } from "../../../test/source-code";

// CANCEL TAKES THE AWB, AND ONLY THE AWB.
//
// KiriminAja's doc is explicit — *"awb: AWB Number Already Obtained, **Not Order ID**"* — and
// `cancelShipment` used to send `o.awb ?? o.kaOrderId`. Every fresh booking has `awb: null` (the
// waybill is issued later; that is why `awbPending` exists), so the fallback fired precisely on the
// parcel a merchant had just created.
//
// Measured against the sandbox, booking `5758-E2E68072665`:
//     cancel_shipment(kj_order_id) → {"ok":false,"error":"Paket tidak ditemukan"}
// The shipment stayed live at the courier and the merchant was shown a vendor string that reads like
// the parcel does not exist — on the one parcel they were looking at. That window (booked by mistake,
// seconds ago, waybill not yet issued) is exactly when someone wants to cancel.
//
// ⚠️ WHY A SOURCE SCAN. There is no way to unit-test this: the failure is a *fallback* that only
// fires when `awb` is null, and both branches type-check, both return a valid shape, and the API
// answers 200 either way — the difference is a `status:false` body the caller reports as "refused".
// What can be pinned is that the fallback is gone and the refusal is actionable.

// ⚠️ `codeOnly` — NOT a hand-rolled comment stripper. The notes EXPLAINING this fix quote the old
// `o.awb ?? o.kaOrderId` verbatim, so a text match fails on its own explanation. That defect has been
// found five times in this repo, each hand-patch with a different hole, which is why
// `test/source-code.ts` exists. Use it. (`codeOnly` also makes string literals inert, so a snippet
// quoted inside a template string cannot masquerade as code either.)
// ⚠️ It joins tokens with single spaces — write the patterns whitespace-tolerantly.
const read = (rel: string) => codeOnly(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"));
const src = read("./actions/shipping.ts");
// The lib assertion is about a COMMENT (the false "AWB (= kj_order_id)" claim), so it reads the raw
// text on purpose — codeOnly would delete the very thing being checked.
const lib = readFileSync(fileURLToPath(new URL("../../../packages/lib/src/kiriminaja.ts", import.meta.url)), "utf8");

describe("cancelShipment never sends an order id as the AWB", () => {
  it("the `awb ?? kaOrderId` fallback is gone", () => {
    // The exact shape that shipped the bug. Its return would be a valid string, so nothing else fails.
    expect(src).not.toMatch(/o\s*\??\.\s*awb\s*\?\?\s*o\s*\??\.\s*kaOrderId/);
  });

  it("what reaches kaCancelShipment is the AWB", () => {
    expect(src).toMatch(/const ref = o\s*\.\s*awb\s*;/);
    expect(src).toMatch(/kaCancelShipment\s*\(\s*ref\s*,\s*reason\s*\)/);
  });

  it("a booking with no waybill is refused BEFORE the network call, with an actionable message", () => {
    // Refusing locally matters twice: it does not spend a provider call on a request the vendor
    // documents as invalid, and it lets us say what to do instead of quoting "Paket tidak ditemukan".
    const start = src.search(/if\s*\(\s*!\s*o\s*\.\s*awb\s*\)/);
    const end = src.search(/const ref = o\s*\.\s*awb\s*;/);
    const guard = start >= 0 && end > start ? src.slice(start, end) : "";
    expect(guard, "a guard on a missing awb must exist before the call").not.toBe("");
    // It must name the button that fetches the waybill — "refused" without a next step is the
    // vendor string wearing our voice.
    expect(guard).toMatch(/Lacak/);
    expect(start).toBeLessThan(src.search(/await kaCancelShipment/));
  });

  it("the lib records the vendor's actual rule next to the call", () => {
    // A wrong comment is how the wrong identifier gets re-introduced by someone who trusted it — the
    // old one asserted an equivalence between the AWB and `kj_order_id` that the vendor doc denies.
    //
    // ⚠️ ASSERTED POSITIVELY, on purpose. The first version of this test ALSO asserted the absence of
    // the old sentence — and failed, because the replacement comment quotes it in order to say it was
    // wrong. A guard that forbids describing the bug it guards is a guard that gets deleted. Requiring
    // the CORRECTION to be present is the claim that actually matters, and it cannot be satisfied by
    // silence.
    expect(lib).toMatch(/Not Order ID/);
    expect(lib).toMatch(/BY AWB, AND ONLY BY AWB/);
  });
});
