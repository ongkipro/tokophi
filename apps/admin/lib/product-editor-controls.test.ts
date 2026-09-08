import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../../test/source-code";

// ── EVERY CONTROL ON THE PRODUCT EDITOR EITHER PERSISTS OR IS NOT THERE (Task 5.2 / F-C8) ────────
//
// The product editor is the biggest form in the Seller panel, and for months some of its controls
// were operable and inert. Measured on 2026-08-21, control by control, against `buildInput()`, the
// two server actions and the schema:
//
//   · "Saluran penjualan → Toko Online"  no channel column on `products`, no reader in any of the
//                                        four surfaces. Off + Simpan + reload came back ON. REMOVED
//                                        — the sibling switch in `collection-editor.tsx` had already
//                                        gone the same way in #289.
//   · "Tag" + three chips                no `products.tags` column anywhere (the only `tags` in the
//                                        schema is `customers.tags`, CRM). Typed, saved, discarded.
//                                        REMOVED.
//   · "Lacak kuantitas"                  hid the Kuantitas input while `stock` was saved either way.
//                                        REMOVED.
//   · "Produk fisik"                     no column — and the only control here that DESTROYED data:
//                                        off + Simpan NULLed `weight_grams` and the three dimension
//                                        columns that price every shipment (N30), then reopened ON
//                                        with a fabricated "500" in the box. REMOVED.
//   · the description toolbar            five buttons with aria-labels and no onClick over a plain
//                                        <Textarea>. REMOVED.
//   · "Barcode"                          the opposite case: `product_variants.barcode` HAS existed
//                                        since the table did and the storefront feed publishes it as
//                                        <g:gtin>, but `buildInput()` dropped the value and the box
//                                        opened empty every time. WIRED, both directions.
//
// ── WHY A CENSUS AND NOT A LIST OF ASSERTIONS ────────────────────────────────────────────────────
//
// A guard bound to the fields that were wrong on the day it was written cannot see the next one. So
// this is a census in the shape of `rbac-census.test.ts`: EVERY piece of form state in the editor
// must be classified, and a `"payload"` classification is a claim the guard checks against
// `buildInput()`'s own body. Add a control and the census fails until someone says which it is;
// drop a field out of the payload and the census fails naming it.
//
// Scope, stated rather than assumed: every form control in that file is a CONTROLLED input backed by
// `React.useState`, so the state list is the control list. An uncontrolled input (a bare `<input>`
// read off a ref at submit) would be invisible here — do not add one; there is none today.
//
// It reads the file's CODE, never its text (`test/source-code.ts`): a commented-out payload line
// would otherwise keep this green while the field went unsaved, which is the exact failure mode this
// repo has now paid for nine times.

const EDITOR = join(__dirname, "..", "app", "(admin)", "produk", "[id]", "product-editor.tsx");
const ACTIONS = join(__dirname, "actions", "products.ts");
const DATA = join(__dirname, "data", "products.ts");
const read = (file: string) => readFileSync(file, "utf8");

/**
 * `"payload"` — a submit field: its value MUST reach `buildInput()`, or the merchant types into
 * nothing. Anything else is local state, and the string is the reason it is not a submit field.
 */
type Fate = "payload" | { readonly local: string };

const FORM_STATE: Record<string, Fate> = {
  // ── the product itself ────────────────────────────────────────────────────────────────────────
  name: "payload",
  description: "payload",
  shortDescription: "payload",
  price: "payload",
  compareAt: "payload",
  cost: "payload",
  sku: "payload",
  barcode: "payload",
  qty: "payload",
  hasVariants: "payload",
  options: "payload",
  variantMap: "payload",
  weight: "payload",
  lengthCm: "payload",
  widthCm: "payload",
  heightCm: "payload",
  status: "payload",
  category: "payload",
  gcatId: "payload",
  gcatPath: "payload",
  gender: "payload",
  ageGroup: "payload",
  material: "payload",
  productType: "payload",
  vendor: "payload",
  seoTitle: "payload",
  metaDesc: "payload",
  handle: "payload",

  // ── local: it feeds a payload field rather than being one ─────────────────────────────────────
  valueDrafts: { local: "the per-option 'ketik nilai lalu Enter' box; Enter/blur commits it into `options`" },
  bulkPrice: { local: "'Terapkan ke semua' writes it across `variantMap`, which is the payload" },
  bulkStock: { local: "same — it lands in `variantMap`" },
  stockMode: { local: "Perbarui stok dialog: tetapkan/tambah/kurangi, arithmetic only" },
  stockAmount: { local: "Perbarui stok dialog: the delta; the RESULT is written into `qty`" },
  handleEdited: { local: "whether the merchant took the handle over, i.e. whether the title still re-slugs it" },
  prevName: { local: "render-time latch for that auto-slug; never submitted" },

  // ── local: a different action entirely ────────────────────────────────────────────────────────
  poSupplier: { local: "Buat pesanan pembelian — its own action, `createPurchaseOrder`" },
  poVariantId: { local: "same dialog" },
  poQty: { local: "same dialog" },
  poCost: { local: "same dialog" },
  poEta: { local: "same dialog" },
  poError: { local: "same dialog — the message it failed with" },

  // ── local: chrome ─────────────────────────────────────────────────────────────────────────────
  catOpen: { local: "dialog open/closed" },
  stockOpen: { local: "dialog open/closed" },
  poOpen: { local: "dialog open/closed" },
  savedSnapshot: { local: "Task 5.6 unsaved-changes guard — the JSON of the last ACCEPTED payload; `dirty` is derived by comparing `buildInput()` against it, so it is never itself submitted" },
  dragOver: { local: "drag-hover styling on the media grid" },
};

const editorCode = () => codeOnly(read(EDITOR));

/** Every `const [x, setX] = React.useState(...)` in the editor — i.e. every control it renders. */
function formState(code: string): string[] {
  return [...code.matchAll(/const\s*\[\s*(\w+)\s*,\s*\w+\s*\]\s*=\s*React\s*\.\s*useState/g)].map((m) => m[1]);
}

/**
 * `buildInput()`'s own body. Anchored between two `const` declarations that sit next to each other
 * in the file; if either name ever moves, this THROWS rather than silently asserting over nothing —
 * a guard that quietly measures an empty string is the failure this whole module exists to stop.
 */
function payloadBody(code: string): string {
  const from = code.indexOf("const buildInput");
  const to = code.indexOf("const handleSave");
  if (from < 0 || to <= from) throw new Error("product-editor.tsx: cannot locate buildInput() between its anchors");
  return code.slice(from, to);
}

/**
 * Is `word` READ here, as a value?
 *
 * ⚠️ A bare `\bword\b` is not good enough and the first draft of this file was green because of it:
 * every payload line is `material: material || undefined`, so the KEY alone satisfies the word — and
 * `material: undefined` would have kept it satisfied while the merchant's input went nowhere. That
 * is precisely the "green for reasons nobody checked" shape. So two positions are excluded:
 *   · preceded by `.` — `ov . price` is a property of someone else's object, not this state;
 *   · followed by `:` — that is an object KEY (`material :`), not a read of the state.
 * A shorthand property (`description ,`) is both at once and correctly counts: it really does read
 * the variable. `codeOnly` joins tokens with single spaces, hence the `\s?` in both guards.
 * Known conservative case: a state used as the CONSEQUENT of a ternary (`x ? state : y`) reads as a
 * key and would fail here. No line in the editor has that shape; a future one fails loudly rather
 * than passing quietly, which is the right way round.
 */
const mentions = (haystack: string, word: string) =>
  new RegExp(`(?<!\\.\\s?)\\b${word}\\b(?!\\s?:)`).test(haystack);

/** `const x = …;` definitions, so one level of indirection counts (`options` → `parsedOptions`). */
function derivations(code: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of code.matchAll(/const\s+(\w+)\s*=\s*([^;]*);/g)) out.set(m[1], m[2]);
  return out;
}

/**
 * Does this state reach the payload? Directly, or through ONE derived const that the payload names
 * — `options` is never written into `buildInput()` by that name; `parsedOptions` is, and it is built
 * from `options`. A link that goes through a derivation is still a link; a name that appears nowhere
 * along the chain is a field the merchant fills for nothing.
 */
function reachesPayload(code: string, state: string): boolean {
  const body = payloadBody(code);
  if (mentions(body, state)) return true;
  for (const [derived, definition] of derivations(code)) {
    if (mentions(body, derived) && mentions(definition, state)) return true;
  }
  return false;
}

describe("product editor — every control is classified, and every submit field is in the payload", () => {
  it("the census covers exactly the form state that exists", () => {
    const actual = formState(editorCode());
    expect(actual.length).toBeGreaterThan(30); // the anchors above resolved to a real component
    const uncensused = actual.filter((s) => !(s in FORM_STATE));
    const stale = Object.keys(FORM_STATE).filter((s) => !actual.includes(s));
    expect({ uncensused, stale }).toEqual({ uncensused: [], stale: [] });
  });

  it.each(Object.entries(FORM_STATE).filter(([, fate]) => fate === "payload").map(([s]) => s))(
    "%s reaches buildInput()",
    (state) => {
      expect(reachesPayload(editorCode(), state)).toBe(true);
    },
  );

  // ── THE MUTATION PROOF ────────────────────────────────────────────────────────────────────────
  // Each assertion above is re-run against a COPY of the file with one defect put back, and must
  // fire. A guard nobody has seen red is green for reasons nobody has checked.
  describe("proved red", () => {
    it("catches a submit field dropped from the payload", () => {
      const dropped = codeOnly(read(EDITOR).replace("material: material || undefined,", ""));
      expect(reachesPayload(dropped, "material")).toBe(false);
      // and the field that was actually wrong before this task
      const noBarcode = codeOnly(read(EDITOR).replace("barcode: barcode || undefined,", ""));
      expect(reachesPayload(noBarcode, "barcode")).toBe(false);
    });

    it("catches a field whose KEY survives while the value stops being read", () => {
      // The subtler half, and the one that made the first draft of this guard vacuous: the line is
      // still there and still named `material`, but nothing the merchant typed is in it.
      const hollow = codeOnly(read(EDITOR).replace("material: material || undefined,", "material: undefined,"));
      expect(reachesPayload(hollow, "material")).toBe(false);
    });

    it("catches the derivation being cut, not just the direct mention", () => {
      // `options` reaches the payload only through `parsedOptions`. Break that one link and the
      // matrix a merchant built stops being submitted, while `options` still exists in the file.
      const cut = codeOnly(read(EDITOR).replace("const parsedOptions = options", "const parsedOptions = ([] as OptionDef[])"));
      expect(reachesPayload(cut, "options")).toBe(false);
    });

    it("catches a new control nobody classified — including these four coming back", () => {
      const code = editorCode();
      for (const revived of ["chOnline", "tags", "trackQty", "physical"]) {
        const readded = codeOnly(
          read(EDITOR).replace(
            "const [barcode, setBarcode]",
            `const [${revived}, set${revived}] = React.useState(true);\n  const [barcode, setBarcode]`,
          ),
        );
        expect(formState(readded).filter((s) => !(s in FORM_STATE))).toEqual([revived]);
      }
      expect(formState(code).filter((s) => !(s in FORM_STATE))).toEqual([]);
    });

    it("catches a census entry left behind after its control is deleted", () => {
      const deleted = codeOnly(read(EDITOR).replace(/const \[material, setMaterial\][^;]*;/, ""));
      expect(Object.keys(FORM_STATE).filter((s) => !formState(deleted).includes(s))).toEqual(["material"]);
    });
  });
});

// ── THE BARCODE ROUND TRIP — three links, and all three had to be added ──────────────────────────
//
// "Survives reload" is not one claim. The value has to be carried into the action, written onto the
// variant row, and selected back out for the editor to seed itself from. Two of those existed for
// `sku` and none for `barcode`, which is exactly why the box looked functional.
describe("barcode round-trips: editor → update action → product_variants → editor", () => {
  it("the editor seeds the field from the saved row", () => {
    expect(codeOnly(read(EDITOR))).toMatch(/const\s*\[\s*barcode\s*,\s*setBarcode\s*\]\s*=\s*React\s*\.\s*useState\s*\(\s*product\s*\?\s*\.\s*barcode/);
  });

  it("the update contract carries it and both writers persist it", () => {
    const code = codeOnly(read(ACTIONS));
    expect(code).toMatch(/barcode\s*\?\s*:\s*string/); // on ProductInput
    expect(code).toMatch(/barcode\s*:\s*input\s*\.\s*barcode/); // onto the implicit-default row
    // createProduct's insert AND updateProduct's reconcile both write the column
    expect([...code.matchAll(/barcode\s*:\s*v\s*\.\s*barcode\s*\|\|\s*null/g)]).toHaveLength(2);
  });

  it("the read layer selects it back", () => {
    const code = codeOnly(read(DATA));
    expect(code).toMatch(/barcode\s*:\s*schema\s*\.\s*productVariants\s*\.\s*barcode/);
    expect(code).toMatch(/barcode\s*:\s*rows\s*\[\s*0\s*\]\s*\.\s*barcode/);
  });

  // Same self-proof: each link cut on a copy, each assertion must fire.
  it("proved red — each link cut in turn", () => {
    expect(codeOnly(read(ACTIONS).replace("barcode: input.barcode ?? null", "")))
      .not.toMatch(/barcode\s*:\s*input\s*\.\s*barcode/);
    expect([...codeOnly(read(ACTIONS).replace("barcode: v.barcode || null,", "")).matchAll(/barcode\s*:\s*v\s*\.\s*barcode\s*\|\|\s*null/g)])
      .toHaveLength(1);
    expect(codeOnly(read(DATA).replace("barcode: schema.productVariants.barcode,", "")))
      .not.toMatch(/barcode\s*:\s*schema\s*\.\s*productVariants\s*\.\s*barcode/);
    expect(codeOnly(read(DATA).replace('barcode: rows[0].barcode ?? "",', "")))
      .not.toMatch(/barcode\s*:\s*rows\s*\[\s*0\s*\]\s*\.\s*barcode/);
    expect(codeOnly(read(EDITOR).replace('React.useState(product?.barcode ?? "")', 'React.useState("")')))
      .not.toMatch(/setBarcode\s*\]\s*=\s*React\s*\.\s*useState\s*\(\s*product/);
  });
});
