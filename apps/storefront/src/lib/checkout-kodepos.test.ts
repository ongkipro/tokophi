// THE KODEPOS IS REQUIRED, AND THE TWO WAYS THAT CAN BE UNDONE ARE BOTH INVISIBLE.
//
// `/api/public/order` is the boundary and it refuses an order with no kodepos on its own — that half
// is pinned by `packages/lib/src/validate.test.ts` (`postcodeError("")` is an error). This file pins
// the FORM half, which no type-checker and no build has an opinion about:
//
//  1. `required` is an ATTRIBUTE in markup. Deleting it changes nothing that `astro check`, lint or
//     `astro build` can see; the checkout simply stops asking.
//  2. ⚠️ `readOnly` SILENTLY CANCELS `required`. A readonly input is barred from constraint
//     validation — `willValidate` is false and `valueMissing` never fires — so re-introducing the
//     "lock the field once we derived the value" behaviour would make the requirement a no-op on
//     exactly the two branches that auto-fill, with the attribute still sitting there in the markup
//     looking correct. Measured in a browser before the change: `required` + `readOnly` reported
//     `willValidate: false`, and Bayar went straight through with an empty kodepos.
//
// And the third, which is the one that bites the shopper rather than us: a programmatic
// `kodeposEl.value = …` fires NEITHER `input` NOR `change`, so it does not clear the custom validity
// left behind by a failed submit. `setCustomValidity(msg)` keeps a control invalid until the string
// is cleared — so a shopper who pressed Bayar with an empty kodepos and then picked a kelurahan that
// filled it FOR them would be refused forever by a field that is now correct. One writer,
// `setKodepos()`, calls `clearValidity("kodepos")`; the guard is that there is only one.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { codeOnly, textWithoutComments } from "../../../../test/source-code";

// TWO views of the same file, and choosing wrongly is the whole point of `test/source-code.ts`:
//   · `required` is markup the page EMITS  → textWithoutComments
//   · `readOnly` / `MISSING` / the writer are things the page EXECUTES → codeOnly
// Both drop `//` and `/* */` comments, so the notes above and in `checkout.astro` stay legal — which
// is also why the kodepos block in that file is commented with `{/* … */}` and not `<!-- … -->`:
// neither function strips an HTML comment (it is served to the browser), so a `<!--` note containing
// the word "required" would keep the first assertion green over a field that no longer asks.
const raw = readFileSync(new URL("../pages/checkout.astro", import.meta.url), "utf8");
const MARKUP = textWithoutComments(raw);
const CODE = codeOnly(raw);

describe("checkout kodepos — required, and nothing quietly cancels it", () => {
  it("the kodepos input carries `required`", () => {
    const input = MARKUP.match(/<\s*input[^>]*name\s*=\s*"kodepos"[^>]*>/);
    expect(input, "the kodepos input is gone from checkout.astro").not.toBeNull();
    expect(input![0]).toMatch(/\brequired\b/);
  });

  it("its label asks for it, and no longer says (opsional)", () => {
    const label = MARKUP.match(/<\s*label[^>]*for\s*=\s*"kodepos"[^>]*>[\s\S]{0,200}?<\/\s*label\s*>/);
    expect(label).not.toBeNull();
    expect(label![0]).not.toMatch(/opsional/i);
  });

  it("nothing sets `readOnly` — that would bar the field from constraint validation", () => {
    // The old `setKodeposManual()` did `kodeposEl.readOnly = !manual`. Any return of that form —
    // under any name — cancels `required` without a single failing build.
    expect(CODE).not.toMatch(/\breadOnly\b/);
  });

  it("`kodepos` is in the MISSING map, so the message is Indonesian and not the browser's", () => {
    // `<form novalidate>` is what makes this checkout speak Indonesian; MISSING is the other half.
    // A required control with no entry here gets labelled by the fallback, or — one stray
    // reportValidity() away — by the BROWSER, in the browser's language.
    // `[^}]*?`, NOT `[\s\S]*?`: the lazy-but-unbounded version walked out of the object literal and
    // matched a `kodepos :` somewhere else entirely, so deleting the entry left this green. Found by
    // mutating the source and re-running — a guard that cannot go red is decoration.
    expect(CODE).toMatch(/MISSING\s*=\s*\{[^}]*?\bkodepos\s*:/);
  });

  it("there is exactly ONE writer of the field's value, and it clears the stale validity", () => {
    const writes = CODE.match(/kodeposEl\s*\.\s*value\s*=/g) ?? [];
    expect(writes.length, "every kodepos write must go through setKodepos()").toBe(1);
    expect(CODE).toMatch(/function\s+setKodepos\s*\([\s\S]{0,400}?clearValidity\s*\(/);
  });

  it("the kelurahan lookup drops a response the shopper has moved on from", () => {
    // Two kecamatan picked in quick succession resolve in whatever order the network returns them.
    // Measured before the guard existed: district A's postcode (55764) landed on an order shipping to
    // district B (Sewon, 552), and the "Kirim ke" card read it back as if it belonged there.
    // `loadRates()` has always compared against the CURRENT dest id; this one had no guard at all.
    const body = CODE.match(/function\s+loadKelurahan\s*\([\s\S]{0,2000}/)?.[0] ?? "";
    // Both halves, because they fail separately: the first pins that the comparison is against the
    // LIVE dest id, the second that it is actually CONSULTED before the response is used. Asserting
    // only the definition stayed green when the call site was neutered to `if (false) return`.
    expect(body).toMatch(/destId\s*\.\s*value\s*\)\s*!==\s*destAtCall/);
    expect(body).toMatch(/if\s*\(\s*stale\s*\(\s*\)\s*\)\s*return/);
  });
});
