import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../../../test/source-code";

// KEL-001 / ADR 0021 — the public order route's ONLY plugin line must run strictly AFTER its order
// transaction has returned. `after()` runs its callback even when the response fails, so a call
// registered inside (or before) `db.transaction(…)` would push an order to a third party that then
// rolled back. Nothing else can see this: tsc, lint and build are all green either way.
// Reads the route's CODE (`codeOnly`), never its text — a comment that mentions `after(` is not a call.
const ROUTE = join(__dirname, "../../app/api/public/order/route.ts");

/** Index just past the `)` that closes the first `db . transaction (` call, in codeOnly output. */
function transactionEnd(code: string): number {
  const start = code.indexOf("db . transaction (");
  if (start < 0) return -1;
  let depth = 0;
  for (let i = start + "db . transaction ".length; i < code.length; i++) {
    if (code[i] === "(") depth++;
    else if (code[i] === ")" && --depth === 0) return i + 1;
  }
  return -1;
}

const calls = (code: string, token: string) => code.split(`${token} (`).length - 1;

/** The claim: one hook call, scheduled through after(), positioned after the transaction closes. */
function hookIsPostCommit(code: string): boolean {
  const end = transactionEnd(code);
  const at = code.indexOf("after ( ( ) => runOrderCreated (");
  return end > 0 && at > end && calls(code, "after") === 1 && calls(code, "runOrderCreated") === 1;
}

describe("public order route — plugin hook runs only after the order commits", () => {
  const code = codeOnly(readFileSync(ROUTE, "utf8"));

  it("finds the transaction it measures from", () => {
    expect(transactionEnd(code)).toBeGreaterThan(0);
  });

  it("schedules runOrderCreated once, via after(), after db.transaction(…) has returned", () => {
    expect(hookIsPostCommit(code)).toBe(true);
  });

  it("the route never calls a plugin directly (eligibility lives inside the plugin)", () => {
    expect(code).not.toMatch(/plugins\s*\/\s*kelola|pushKelolaOrder|drainKelola/);
  });

  // Mutation self-check: the predicate must FIRE on the shapes it exists to refuse, or it could be
  // green for want of matching anything.
  it("refuses a copy with the hook moved INSIDE the transaction callback", () => {
    const moved = code
      .replace("after ( ( ) => runOrderCreated ( store . id , order . id ) ) ;", "")
      .replace("db . transaction ( async ( tx ) => {", "db . transaction ( async ( tx ) => { after ( ( ) => runOrderCreated ( store . id , order . id ) ) ;");
    expect(moved).not.toBe(code);
    expect(hookIsPostCommit(moved)).toBe(false);
  });

  it("refuses a copy that calls the hook directly, without after()", () => {
    const direct = code.replace("after ( ( ) => runOrderCreated (", "void ( ( ) => runOrderCreated (");
    expect(direct).not.toBe(code);
    expect(hookIsPostCommit(direct)).toBe(false);
  });
});
