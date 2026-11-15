// THE NAMED DEFAULT (SPX Standard) IS RECOGNISED UNDER BOTH PROVIDERS' BOOKING CODES (SHIP-MENGANTAR).
//
// The checkout preselects SPX Standard and, when the route has none, says "SPX Reguler tidak tersedia
// untuk rute ini". The default provider books it as service `type "1"`; Mengantar quotes it under its
// estimate key `type "spx"`. Matching only "1" made every Mengantar quote print that sentence directly
// under the SPX row it had just preselected (seen in a browser, 2026-11-11, sandbox quote Surabaya →
// Semarang Tengah). The script is inline in `checkout.astro`, so this lifts the ONE statement that
// decides the default out of the executed code (`codeOnly` — a commented-out fix must not pass) and
// runs it against both shapes.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { codeOnly } from "../../../../test/source-code";

const CODE = codeOnly(readFileSync(new URL("../pages/checkout.astro", import.meta.url), "utf8"));
const expr = /var\s+preferred\s*=\s*(fast\s*\.\s*filter\s*\([\s\S]*?\)\s*\[\s*0\s*\])\s*;/.exec(CODE)?.[1] ?? "";
const pickDefault = new Function("fast", `return ${expr};`) as (fast: { code: string; type: string }[]) => { type: string } | undefined;

describe("checkout default service — SPX Standard under either provider", () => {
  it("finds the statement (a guard that matches nothing is green forever)", () => {
    expect(expr).not.toBe("");
  });

  it.each([
    ["default provider", [{ code: "jne", type: "REG23" }, { code: "spx", type: "3" }, { code: "spx", type: "1" }], "1"],
    ["Mengantar", [{ code: "jne", type: "JNE" }, { code: "spx", type: "spx" }], "spx"],
  ])("%s: SPX Standard is the default", (_label, fast, want) => {
    expect(pickDefault(fast)?.type).toBe(want);
  });

  it("SPX Economy and other couriers are never the named default", () => {
    expect(pickDefault([{ code: "spx", type: "3" }, { code: "jne", type: "JNE" }])).toBeUndefined();
  });
});
