import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { codeOnly, textWithoutComments } from "../../../../test/source-code";

// 🔴 EVERY FORM THAT POSTS TO `/api/public/order` MUST SEND A `kodepos`. DERIVED, NOT LISTED.
//
// `checkout-kodepos.test.ts` beside this one guards `checkout.astro` — by NAME. That is exactly the
// blind spot that cost eighteen days of orders: `b5f9ded` made the postcode required at the API on
// 2026-08-03 and patched the one file the guard knew about. `OrderFunnel.astro` — the form behind
// `/promo/<handle>` and `/lp/<slug>`, i.e. the pages paid traffic lands on — kept posting
// `{alamat, kota, provinsi}`. Measured 2026-08-21: `postcodeError(undefined)` → "Kode pos wajib
// diisi." → the route answers 400 and writes NOTHING. Zero orders, on the ad funnel, silently — and
// the funnel's own `showErr` pointed at a `[data-err="kodepos"]` that did not exist, so the shopper
// saw no reason either.
//
// So this guard finds the forms itself: any storefront source that POSTs to the order API is one,
// and a new one added tomorrow is covered on the day it is written. Never bind a guard to a list of
// targets — this repo has now paid for that twice.

const SRC = join(import.meta.dirname, "..");

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sources(full, out);
    else if (/\.(astro|ts)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Files that submit an order: they name the order API and build an `address` object for it. */
const orderForms = sources(SRC)
  .map((file) => ({ file, raw: readFileSync(file, "utf8") }))
  .filter(({ raw }) => /ORDER_API|api\/public\/order/.test(raw) && /address\s*:\s*\{/.test(raw));

describe("every storefront form that submits an order sends a postcode", () => {
  it("finds the forms at all (a guard that matches nothing is not a guard)", () => {
    expect(orderForms.map((f) => f.file.slice(SRC.length + 1))).toContain(
      "components/OrderFunnel.astro",
    );
    expect(orderForms.length).toBeGreaterThanOrEqual(2);
  });

  it.each(orderForms.map((f) => [f.file.slice(SRC.length + 1), f.raw] as const))(
    "%s puts kodepos in the address it posts",
    (_name, raw) => {
      // CODE, not text: a comment mentioning kodepos must not satisfy this, and neither must a
      // sentence in a string. The claim is about what the file EXECUTES.
      //
      // ⚠️ EVERY `address :` in the file, not the first. `checkout.astro`'s first one is a TYPE
      // declaration (`address: string; city: string; …`) hundreds of lines above the payload — the
      // first draft of this test sliced from there, found no kodepos, and reported a file that is
      // demonstrably correct as broken. At least one address block must carry it.
      const code = codeOnly(raw);
      const blocks: string[] = [];
      for (let i = code.indexOf("address :"); i !== -1; i = code.indexOf("address :", i + 1)) {
        blocks.push(code.slice(i, i + 400));
      }
      expect(blocks.length, "no address object found at all").toBeGreaterThan(0);
      expect(blocks.some((b) => /kodepos/.test(b)), "no address payload carries kodepos").toBe(true);
    },
  );

  it.each(orderForms.map((f) => [f.file.slice(SRC.length + 1), f.raw] as const))(
    "%s can SHOW the postcode error it may receive",
    (_name, raw) => {
      // The API answers `field: "kodepos"`. A form that cannot render that message refuses the
      // order and explains nothing — which is how this went unnoticed for eighteen days.
      //
      // TWO legitimate mechanisms, and the guard must accept both or it fails a correct file:
      //   · a STATIC slot in the markup — `<p data-err="kodepos">` (OrderFunnel);
      //   · a DYNAMIC writer keyed on the control's own `name`, which creates that same element on
      //     demand (checkout.astro's `errSlot`/`showFieldError`, plus `kodepos` in its MISSING map
      //     so the sentence is ours and not the browser's).
      // The first draft demanded the static slot from both and failed `checkout.astro`, whose
      // machinery is demonstrably right there — a guard that fails correct code gets weakened next
      // time by someone in a hurry, so it is fixed here instead.
      //
      // ⚠️ WHITESPACE-TOLERANT: the scanner joins tokens with single spaces, so the attribute reads
      // `data - err = "kodepos"`. `test/source-code.ts` says to write patterns this way.
      const markup = textWithoutComments(raw);
      const code = codeOnly(raw);
      const staticSlot = /data\s*-\s*err\s*=\s*"kodepos"/.test(markup);
      const dynamicSlot = /setAttribute\s*\(\s*"data-err"/.test(code) && /kodepos/.test(code);
      expect(
        staticSlot || dynamicSlot,
        "no way to render the kodepos error the API can return",
      ).toBe(true);
    },
  );

  it.each(orderForms.map((f) => [f.file.slice(SRC.length + 1), f.raw] as const))(
    "%s never makes the postcode readOnly — that silently cancels `required`",
    (_name, raw) => {
      // A readonly input is barred from constraint validation: `willValidate` is false and
      // `valueMissing` never fires. Measured in a browser when the cart checkout had this shape.
      const code = codeOnly(raw);
      expect(code).not.toMatch(/kodepos[^;]{0,120}readOnly\s*=\s*true/i);
    },
  );

  // Proves the predicate can fail — a guard nobody has seen red is green for reasons nobody checked.
  it("goes red on a form whose address drops the postcode", () => {
    const funnel = orderForms.find((f) => f.file.endsWith("OrderFunnel.astro"))!;
    const reverted = codeOnly(funnel.raw.replace(/kodepos:\s*\(byId\("f-kodepos"\)[^,]*,?/, ""));
    const blocks: string[] = [];
    for (let i = reverted.indexOf("address :"); i !== -1; i = reverted.indexOf("address :", i + 1)) {
      blocks.push(reverted.slice(i, i + 400));
    }
    expect(blocks.some((b) => /kodepos/.test(b))).toBe(false);
  });
});
