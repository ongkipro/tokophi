import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { codeOnly, textWithoutComments } from "../../../test/source-code";

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

// ── Task 5.1 / F-S12: THE INTENT IS RECORDED BEFORE THE VENDOR CALL, THE ANSWER AFTER ────────────
//
// `cancelShipment` used to call `kaCancelShipment` FIRST and write `cancellation_requested` after.
// A throw between the two (DB hiccup, process killed by a deploy) left the courier holding a queued
// void the database never heard about — and because the write was the only record, the merchant
// could press the button again and send a second one. The action is a "use server" function behind
// `requireCapability` + `withTenant`, so — like the AWB rule above — the ORDER of its writes is a
// claim about the source, pinned here with `codeOnly`. The reconciler that reads the row back is
// exercised against real Postgres in `cancel-reconcile.test.ts`.
describe("cancelShipment records intent before the vendor call and the answer after", () => {
  const fn = src.slice(src.search(/export async function cancelShipment/), src.search(/async function recordCancelAnswer/));
  const call = fn.search(/await kaCancelShipment\s*\(/);

  it("the booking flips to cancellation_requested BEFORE kaCancelShipment is awaited", () => {
    const intent = fn.search(/status\s*:\s*"cancellation_requested"/);
    expect(intent).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(-1);
    expect(intent).toBeLessThan(call);
    // …and under the same locks every other booking write takes.
    const before = fn.slice(0, call);
    expect(before).toMatch(/pg_advisory_xact_lock/);
    expect(before).toMatch(/\.\s*for\s*\(\s*"update"\s*\)/);
  });

  it("a second click cannot send a second request: the locked read refuses an already-pending booking", () => {
    const before = fn.slice(0, call);
    expect(before).toMatch(/booking\s*\?\.\s*status\s*===\s*"cancellation_requested"/);
  });

  it("a transport error keeps the intent (never rolls it back to accepted) and says so to the merchant", () => {
    // The catch directly after the vendor call (string contents are inert under codeOnly, so the
    // anchor is the `catch`, not the log message inside it).
    const start = call + fn.slice(call).search(/catch\s*\(\s*error\s*\)\s*\{/);
    const end = fn.search(/if\s*\(\s*!\s*result\s*\.\s*ok\s*\)/);
    expect(start).toBeGreaterThan(call);
    const branch = fn.slice(start, end);
    expect(branch).toMatch(/status\s*:\s*"cancellation_requested"/);
    expect(branch).not.toMatch(/status\s*:\s*"accepted"/);
    expect(branch).toMatch(/pending\s*:/);
  });

  it("a vendor refusal restores `accepted` — the shipment still stands at the courier", () => {
    const start = fn.search(/if\s*\(\s*!\s*result\s*\.\s*ok\s*\)/);
    const end = fn.search(/menunggu konfirmasi void\/refund provider/);
    const branch = fn.slice(start, end);
    expect(branch).toMatch(/status\s*:\s*"accepted"/);
  });

  it("every post-call write is best-effort: it goes through recordCancelAnswer, which catches instead of throwing", () => {
    const after = fn.slice(call);
    // No direct booking write after the call — only the helper.
    expect(after).not.toMatch(/\.\s*update\s*\(\s*schema\s*\.\s*shipmentBookings\s*\)/);
    expect((after.match(/recordCancelAnswer\s*\(/g) ?? []).length).toBe(3);
    const helper = src.slice(src.search(/async function recordCancelAnswer/));
    expect(helper).toMatch(/try\s*\{/);
    expect(helper).toMatch(/catch\s*\(\s*error\s*\)/);
    expect(helper).not.toMatch(/throw\b/);
    // The helper never clobbers a state the reconciler may already have moved on from. A claim about
    // RAW SQL in a `sql` template → `textWithoutComments` (the repo rule; codeOnly inerts literals).
    const rawHelper = textWithoutComments(readFileSync(fileURLToPath(new URL("./actions/shipping.ts", import.meta.url)), "utf8"));
    const h = rawHelper.slice(rawHelper.search(/async function recordCancelAnswer/));
    expect(h).toMatch(/\.\s*status\s*\}\s*=\s*'cancellation_requested'/);
  });
});
