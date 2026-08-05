import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { puckFieldOverrides } from "./theme/puck-field-overrides";
import { ToggleRow } from "../components/admin/pengaturan/toggle-row";
import { FormFieldsCard } from "../components/admin/form-fields-card";
import { SearchInput } from "../components/admin/search-input";

// Every Seller form control is announced as SOMETHING.
//
// ── WHAT WAS MEASURED, AND HOW ────────────────────────────────────────────────────────────────────
//
// 2026-08-05, logged in to a real store in Chromium, reading the name Blink itself computes
// (`Accessibility.getPartialAXTree` over CDP, which also reports WHICH attribute produced it — a
// `<label>` says `relatedElement`, a fallback says `placeholder`). Not grepped: an `aria-label` can
// be present in a file and superseded, and a `<Label>` drawn without `htmlFor` looks correct in
// review and names nothing.
//
// 66 rendered controls came back with an accessible name of **""**:
//
//   · 30 · the store builder's field panel (`lib/theme/puck-field-overrides.tsx`) — one `FieldWrapper`,
//          four field types, `<Label>` with no `htmlFor` over controls with no `id`. Every field on
//          the one screen that IS a form.
//   · 20 · /pengaturan → Pengiriman (`jasa-kirim-card.tsx`) — COD, gratis ongkir, and one per courier
//          service. The audit that "fixed /pengaturan" fixed the toggles routed through `ToggleRow`;
//          this card hand-rolls its own and was missed.
//   ·  6 · /pemasaran → Pelacakan, two per tracking channel.
//   ·  6 · /promo/[id] — two in the editor, four in `FormFieldsCard` (which the custom-HTML landing
//          editor renders too, so that one component was six).
//   ·  2 · /pengaturan → Pajak, a hand-rolled copy of ToggleRow's own markup minus the naming.
//   ·  1 · the brand-colour well in the store builder.
//   · +1 per product on /flash-sale/[id] — 22 in the demo catalogue, and it grows with the shop.
//
// ── WHY THIS FILE MIXES A RENDER WITH A SWEEP ────────────────────────────────────────────────────
//
// The four components below are importable and pure, so they are RENDERED and the output is read —
// which is strictly better than any scan, and is what `dashboard-empty.test.tsx` does for the same
// reason. What a render cannot cover is the call sites: `flash-editor`, `promo-editor-client`,
// `jasa-kirim-card` and friends all reach `useRouter`/`useCan`, so there is nothing to call. Those
// get the sweep at the bottom — and the sweep is the half that has to survive the NEXT switch
// somebody adds, which is the failure mode this defect keeps taking (`ToggleRow` was named in wave 8
// and five other files went on being nameless).
//
// The sweep uses the TypeScript **parser**, not a regex and not `codeOnly` + a regex. CLAUDE.md's
// rule is "never hand-roll a comment stripper", and `test/source-code.ts` says it prefers the
// scanner because the files that need it are `.astro` and do not parse as TypeScript. These files
// are `.tsx` — real TypeScript programs — so the real AST is available, and it is the only thing
// that can reliably tell a `<Switch>`'s attribute list from a `>` inside `onCheckedChange={(v) =>
// …}`. A comment is trivia and a `<Switch` inside a string is a string, so both smuggles the shared
// module exists to stop are closed by construction here.

const ADMIN = fileURLToPath(new URL("..", import.meta.url));

/** `<label for="x">` ⋈ a control carrying `id="x"` — the association a browser actually acts on. */
function labelledIds(html: string): { labels: string[]; controls: string[] } {
  const labels = [...html.matchAll(/<label[^>]*\bfor="([^"]+)"/g)].map((m) => m[1]);
  const controls = [...html.matchAll(/<(?:input|textarea|select|span|button)[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);
  return { labels, controls };
}

function expectAssociated(html: string, count: number) {
  const { labels, controls } = labelledIds(html);
  expect(labels).toHaveLength(count);
  for (const id of labels) expect(controls, `no control carries id="${id}"`).toContain(id);
}

describe("the shared form components name their control", () => {
  // Puck hands each field type `{ field, name, value, onChange, readOnly }`. The overrides are plain
  // functions, so they can simply be called.
  const call = (type: keyof typeof puckFieldOverrides, field: object, value: unknown) => {
    const Render = puckFieldOverrides[type] as unknown as React.ComponentType<Record<string, unknown>>;
    return renderToStaticMarkup(
      <Render field={{ type, ...field }} name="judul" id="x" value={value} onChange={() => {}} readOnly={false} />,
    );
  };

  it("puck text field", () => expectAssociated(call("text", { label: "Judul" }, "a"), 1));
  it("puck textarea field", () => expectAssociated(call("textarea", { label: "Isi" }, "a"), 1));
  it("puck number field", () => expectAssociated(call("number", { label: "Jumlah", min: 2, max: 24 }, 4), 1));
  it("puck select field", () =>
    expectAssociated(call("select", { label: "Gaya", options: [{ label: "A", value: "a" }] }, "a"), 1));

  // The label must be the words on screen, not a paraphrase that can drift away from them.
  it("puck fields label with the field's own text", () => {
    expect(call("text", { label: "Judul Bagian" }, "")).toContain("Judul Bagian");
  });

  it("ToggleRow", () => {
    const html = renderToStaticMarkup(
      <ToggleRow title="Aktifkan PPN" description="Tambahkan PPN." checked onCheckedChange={() => {}} />,
    );
    expectAssociated(html, 1);
    expect(html).toContain("Aktifkan PPN");
  });

  it("FormFieldsCard names all four toggles", () => {
    const html = renderToStaticMarkup(
      <FormFieldsCard
        value={{ email: true, quantity: false, trustBadges: true, summary: false }}
        onChange={() => {}}
      />,
    );
    expectAssociated(html, 4);
  });

  // Two of these are mounted at once in the app (product-promo editor and custom-HTML editor). A
  // fixed id would put the same `#email` on the page twice, and `htmlFor` would then name whichever
  // one the browser found first — with no error anywhere.
  it("FormFieldsCard ids are unique per instance", () => {
    const one = (
      <FormFieldsCard value={{ email: true, quantity: true, trustBadges: true, summary: true }} onChange={() => {}} />
    );
    const html = renderToStaticMarkup(
      <>
        {one}
        {one}
      </>,
    );
    const { labels } = labelledIds(html);
    expect(labels).toHaveLength(8);
    expect(new Set(labels).size).toBe(8);
  });

  it("SearchInput", () => {
    const html = renderToStaticMarkup(
      <SearchInput label="Cari produk" value="" onValueChange={() => {}} placeholder="Cari produk…" />,
    );
    expect(html).toContain('aria-label="Cari produk"');
  });
});

// ── the sweep ────────────────────────────────────────────────────────────────────────────────────

/** Every `.tsx` under apps/admin, minus the places nothing renders from. */
function tsxFiles(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".next") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) tsxFiles(p, acc);
    else if (e.name.endsWith(".tsx") && !e.name.endsWith(".test.tsx")) acc.push(p);
  }
  return acc;
}

/** Named attributes on every `<Switch …>` element in a parsed .tsx file. */
function switchAttributes(file: string): { line: number; attrs: Set<string> }[] {
  const src = readFileSync(file, "utf8");
  if (!src.includes("<Switch")) return []; // sound: the parser never invents a tag the text lacks
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: { line: number; attrs: Set<string> }[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) {
      if (n.tagName.getText(sf) === "Switch") {
        const attrs = new Set<string>();
        for (const a of n.attributes.properties) {
          if (ts.isJsxAttribute(a)) attrs.add(a.name.getText(sf));
          else attrs.add("{...spread}");
        }
        out.push({ line: sf.getLineAndCharacterOfPosition(n.pos).line + 1, attrs });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/**
 * Base UI's Switch renders a `<span role="switch">`, which is NOT a labelable element — so a
 * `<label>` WRAPPING one names nothing, and `htmlFor` is not merely the nicer option, it is the only
 * native one. Base UI resolves it into `aria-labelledby` itself (measured on `/produk/[id]`, where
 * `<Label htmlFor="p-hasvar">` surfaces as `aria-labelledby="p-hasvar-label"`).
 *
 * So one of these three must be present, and there is no fourth way to name one.
 */
const NAMES_A_SWITCH = ["id", "aria-label", "aria-labelledby"];

describe("every <Switch> can be named", () => {
  const files = tsxFiles(ADMIN);

  // A walker that finds nothing passes every assertion after it.
  it("finds the admin's .tsx files", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.flatMap(switchAttributes).length).toBeGreaterThan(15);
  });

  it("…and each one carries id / aria-label / aria-labelledby", () => {
    const bare = files.flatMap((f) =>
      switchAttributes(f)
        .filter((s) => !NAMES_A_SWITCH.some((k) => s.attrs.has(k)) && !s.attrs.has("{...spread}"))
        .map((s) => `${relative(ADMIN, f)}:${s.line}`),
    );
    expect(bare).toEqual([]);
  });
});
