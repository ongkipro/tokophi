import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { codeOnly, textWithoutComments } from "../../../test/source-code";

// 🔵 THE FLIP IS BOOKKEEPING. IT DOES NOT MOVE THE STORE'S SUBSCRIPTION (owner ruling, 2026-08-20).
//
// `setInvoiceStatus` writes `invoices.status` and nothing else. There are exactly three writers of
// `stores.current_period_end` in the repo — `api/public/pay/callback`, `compStore`, `extendTrial` —
// and this is none of them. The failure that made this worth pinning was not the behaviour but the
// BELIEF: the action's own comment asserted that a manual flip "extends a store's paid period", the
// toast said "Invoice INV-4821 → dibayar." with no limit, and the audit line said the status
// changed with no scope. An operator fixing a failed webhook reads all three as "the merchant is
// unlocked", finds them still read-only, and reaches for "Gratiskan 1 bulan" — filing a GIVEAWAY
// for a month that was actually paid for.
//
// A source guard for the same reason `add-store-user.test.ts` is one: `actions.ts` is `"use server"`
// and imports `@tokophi/db` at module scope, so it cannot be imported here.
//
// ⚠️ Two readers, deliberately, one per claim (`test/source-code.ts`). The CODE claim — that this
// action never touches `currentPeriodEnd` — uses `codeOnly`, which inerts string contents so a
// sentence mentioning the column cannot satisfy it. The COPY claims are about text the screen EMITS
// to an operator, and that text lives inside string literals, so `codeOnly` would erase the very
// evidence and go permanently green.

const ACTIONS_SRC = readFileSync(new URL("./actions.ts", import.meta.url), "utf8");
const SCREEN_SRC = readFileSync(
  new URL("../app/(platform)/paket/paket-client.tsx", import.meta.url),
  "utf8",
);

/** One top-level action's source, from its `export async function` to the next top-level `export`. */
function actionSource(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}`);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  const next = src.indexOf("\nexport ", start + 1);
  return next === -1 ? src.slice(start) : src.slice(start, next);
}

describe("setInvoiceStatus is a ledger correction, not an entitlement change", () => {
  const body = actionSource(ACTIONS_SRC, "setInvoiceStatus");

  it("never writes the store's subscription period", () => {
    const code = codeOnly(body);
    expect(code).not.toMatch(/currentPeriodEnd/);
    expect(code).not.toMatch(/firstInvoicePaid/);
    // `schema.stores` at all: the ruling is that entitlement moves on payment events only, so this
    // action has no business writing that table by any column.
    expect(code).not.toMatch(/schema\s*\.\s*stores/);
  });

  // Proves the predicate can fail — a source guard nobody has seen red is green for reasons nobody
  // has checked. This is the shape the finding recommended as the ALTERNATIVE ruling; if it is ever
  // adopted, this test is what has to be rewritten, deliberately.
  it("goes red if the extension is ever grafted in", () => {
    const grafted = codeOnly(
      body.replace(
        "revalidatePath(\"/paket\");",
        "await db.update(schema.stores).set({ currentPeriodEnd: new Date() });\n  revalidatePath(\"/paket\");",
      ),
    );
    expect(grafted).toMatch(/currentPeriodEnd/);
  });

  it("says so in the audit line it writes", () => {
    // The trail is read long after the fact by someone reconstructing what happened to a store.
    expect(textWithoutComments(body)).toMatch(/masa aktif toko tidak berubah/i);
  });

  it("refuses an invoice number that matched nothing", () => {
    const code = codeOnly(body);
    expect(code).toMatch(/\.\s*returning\s*\(/);
    expect(code).toMatch(/ok\s*:\s*false/);
  });
});

describe("the operator is told the limit on both sides of the click", () => {
  const screen = textWithoutComments(SCREEN_SRC);

  it("the menu says it BEFORE the click", () => {
    expect(screen).toMatch(/Pembukuan saja\s*—\s*tidak mengubah masa aktif toko/i);
  });

  it("the toast says it AFTER, in both directions", () => {
    expect(screen).toMatch(/masa aktif toko TIDAK diperpanjang/);
    expect(screen).toMatch(/tidak ditarik kembali/);
  });

  // A toast that names the next step is the difference between an honest limit and a dead end: the
  // operator wanted to unlock the merchant, and "Gratiskan 1 bulan" is what actually does that.
  it("the paid direction names what DOES grant time", () => {
    expect(screen).toMatch(/Gratiskan 1 bulan/);
  });
});
