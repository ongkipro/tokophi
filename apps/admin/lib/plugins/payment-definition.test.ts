import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly, textWithoutComments } from "../../../../test/source-code";

// KEL-001 — the plugin's "prepaid only once paid" rule and the payload's `payment` field must read THE
// order's payment the same way every Seller screen does: `latestPaymentFirst()` (lib/data/order-payment.ts).
// The paused branch hand-wrote `paid_at desc nulls last, id desc`; PAY-RETRY (0118) then added
// `created_at desc` to the one definition, and the copy silently fell behind — tsc, lint and every
// existing test stay green on a stale copy. A hand-written payment ordering here is the regression.
//   - SQL claim → `textWithoutComments` (the ordering lives inside an executed `sql` template);
//   - call claim → `codeOnly` (a comment naming the helper is not a call).
const SYNC = join(__dirname, "kelola/sync.ts");
const HAND_ORDERED = /order\s+by\s+[\w."]*paid_at\b/i;

describe("Kelola plugin reads the order's payment through the ONE definition", () => {
  const src = readFileSync(SYNC, "utf8");

  it("no hand-written payment ordering in the executed SQL", () => {
    expect(textWithoutComments(src)).not.toMatch(HAND_ORDERED);
  });

  it("uses latestPaymentFirst() for both the eligibility rule and the payload", () => {
    expect(codeOnly(src).split("latestPaymentFirst ( )").length - 1).toBeGreaterThanOrEqual(2);
  });

  it("the predicate fires on the paused branch's copy, and not on the helper call", () => {
    expect(textWithoutComments("sql`select 1 from payments p order by p.paid_at desc nulls last, p.id desc`")).toMatch(HAND_ORDERED);
    expect(textWithoutComments("sql`select 1 from payments order by ${latestPaymentFirst()} limit 1`")).not.toMatch(HAND_ORDERED);
  });
});
