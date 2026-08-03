import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SECTIONS_BY_TEMPLATE_TYPE, SECTION_DEFAULTS, type SectionType } from "@tokophi/sections";
import { codeOnly } from "../../../../../test/source-code";

// `SectionRenderer.astro` is the ONLY thing that turns a saved `page_templates.sections[].type` into
// pixels. It had 14 `case` arms, no `default:` and no exhaustiveness assertion, so **a type added to
// `SectionConfigMap` and forgotten compiled and rendered nothing** — part of a merchant's published
// page disappeared with no error and no failed build.
//
// The compile-time half of the fix is `const _exhaustive: never = item` in the `default:` arm. This
// test exists because the compiler over that file only runs where someone remembers to run it: the
// storefront's build is a bare `astro build` (transpile-only). `astro check` DOES catch everything
// below and is now chained into `npm test` (root `check:storefront`) — but it is a 14-second whole-app
// typecheck, so it is the second line, not the first. `npx vitest run` is what a developer runs.
//
// ⚠️ THIS FILE USED TO MATCH `case "…":` WITH A REGEX OVER THE RAW FILE TEXT, AND THAT IS NOT A GATE.
// **Commenting an arm out leaves the text**, so an audit commented out `case "lookbook":` and all four
// tests stayed green while the renderer would have dropped every `lookbook` section on a live
// storefront — including the demo homepage's own template, which contains one. Each arm is also
// checked for the component it actually returns — an arm that renders the WRONG component is the
// other half of "this type is covered" that text matching cannot see.
//
// ⚠️ AND THEN IT GREW THE SAME HOLE AGAIN, ONE LEVEL DOWN. The first fix ran the TypeScript lexer and
// joined `getTokenText()` — which for a string or template token IS THE RAW SOURCE OF THE LITERAL, so
// the contents were re-injected as if they were code. Deleting the real arm and planting
// ``const doc = `case "lookbook": return <Lookbook />`;`` kept all five tests green. Comments were not
// code; strings still were.
//
// The rule, and the shared implementation, now live in `test/source-code.ts`: a guard asserts against
// a file's CODE, never its TEXT, and `codeOnly()` is the one answer to what that means — comments are
// trivia to a lexer, and every literal's contents are re-emitted inert. Assertions here are therefore
// whitespace-tolerant, because that helper joins tokens with spaces.
//
// Why not the AST: this is an `.astro` file, so it is not a TypeScript program — see that file.
//
// Note which list is authoritative. `SECTION_DEFAULTS` is typed `SectionConfigMap`, so TypeScript
// requires an entry for EVERY `SectionType` — its keys are the complete union at runtime.
// `SECTION_TYPES` (the builder sidebar's order) is a plain `SectionType[]` and can legally omit one.

const SRC = readFileSync(
  fileURLToPath(new URL("./SectionRenderer.astro", import.meta.url)),
  "utf8",
);

const ALL_TYPES = Object.keys(SECTION_DEFAULTS).sort() as SectionType[];

const CODE = codeOnly(SRC);

/**
 * type → the component that arm renders. An arm that exists but returns something other than a
 * component is absent from this map on purpose: "has an arm" and "renders its section" are the same
 * claim, and only the first one was ever being checked.
 */
const RENDERS = new Map(
  [...CODE.matchAll(/case\s*"([a-z0-9-]+)"\s*:\s*return\s*<\s*([A-Za-z_][A-Za-z0-9_]*)/g)].map(
    (m) => [m[1], m[2]] as const,
  ),
);
const ARMS = [...RENDERS.keys()].sort();

/** `product-listing` → `productlisting`; `ProductListingSection` → `productlistingsection`. */
const flatten = (s: string) => s.replace(/[^a-z0-9]/gi, "").toLowerCase();

describe("SectionRenderer covers every section type", () => {
  it("has a case arm for every key of SectionConfigMap", () => {
    // Adding a type to `SectionConfigMap` (and therefore to `SECTION_DEFAULTS`, which tsc forces)
    // without an arm here fails RIGHT NOW, not on a live storefront. So does commenting one out.
    expect(ARMS).toEqual(ALL_TYPES);
  });

  it("each arm renders the component that belongs to its type", () => {
    // An arm can be present and still be wrong: `case "lookbook": return <Blog …/>` is caught by no
    // vitest suite and by no build — only `astro check` compiles this file — and it publishes the
    // wrong section under the merchant's own template.
    //
    // The rule is the repo's naming, not a hand-kept table that would rot: the component's name
    // starts with the type's letters (`image-text` → `ImageText`, `product-listing` →
    // `ProductListingSection`). If a component ever legitimately diverges from its type's name, that
    // is a rename worth arguing in the PR — pin it here deliberately, do not weaken the rule.
    const wrong = [...RENDERS].filter(([type, component]) => !flatten(component).startsWith(flatten(type)));
    expect(wrong.map(([t, c]) => `${t} → <${c} />`)).toEqual([]);
  });

  it("keeps the compile-time exhaustiveness assertion", () => {
    // The `never` assignment is what makes the omission a compile error under `astro check`. It is
    // one "unused variable" cleanup away from being deleted, and the deletion is silent.
    expect(CODE).toMatch(/default\s*:\s*\{/);
    expect(CODE).toMatch(/const\s+_exhaustive\s*:\s*never\s*=\s*item/);
  });

  it("an unknown type is reported, never silently dropped", () => {
    // The runtime half: a type this deploy does not know (an older saved template, a rolled-back
    // deploy) must leave a trace. Server warning always — this is SSR, so it reaches the container
    // log; visible panel in DEV only, because a shopper must not be shown our internal error on a
    // merchant's live shop.
    expect(CODE).toMatch(/console\s*\.\s*warn\s*\(/);
    expect(CODE).toMatch(/import\s*\.\s*meta\s*\.\s*env\s*\.\s*DEV/);
  });

  it("narrowing the PALETTE never narrows the RENDERER", () => {
    // `SECTIONS_BY_TEMPLATE_TYPE` decides what the builder OFFERS per page type; this file decides
    // what still RENDERS. Dropping a section from a palette must only stop merchants adding more —
    // a template saved earlier that holds it keeps its published work. So the renderer's arms are a
    // superset of every palette, and the assertion above pins the stronger form: they are the whole
    // union, including types no palette offers at all.
    const offered = new Set(Object.values(SECTIONS_BY_TEMPLATE_TYPE).flat());
    const armSet = new Set(ARMS);
    expect([...offered].filter((t) => !armSet.has(t))).toEqual([]);
  });
});
