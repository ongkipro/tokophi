import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { SECTIONS_BY_TEMPLATE_TYPE, SECTION_DEFAULTS, type SectionType } from "@tokophi/sections";

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
// storefront — including the demo homepage's own template, which contains one. The arms are now read
// off the TypeScript LEXER (comments are trivia, so they are simply not there) rather than off the
// characters, and each arm is checked for the component it actually returns — an arm that renders the
// WRONG component is the other half of "this type is covered" that text matching cannot see.
//
// Why the lexer and not the alternatives: stripping comments with a regex is the same class of
// mistake one layer down (it eats a `//` inside a string), and rendering the component for real needs
// Astro's vite pipeline wired into the root vitest config — which every other suite in the repo would
// then pay for, to prove a mapping that is static. `typescript` is already a dependency of this app.
//
// Note which list is authoritative. `SECTION_DEFAULTS` is typed `SectionConfigMap`, so TypeScript
// requires an entry for EVERY `SectionType` — its keys are the complete union at runtime.
// `SECTION_TYPES` (the builder sidebar's order) is a plain `SectionType[]` and can legally omit one.

const SRC = readFileSync(
  fileURLToPath(new URL("./SectionRenderer.astro", import.meta.url)),
  "utf8",
);

const ALL_TYPES = Object.keys(SECTION_DEFAULTS).sort() as SectionType[];

/** The file with every comment removed — the lexer emits tokens, and a comment is not a token. */
function codeOnly(src: string): string {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, /* skipTrivia */ true, ts.LanguageVariant.JSX, src);
  const tokens: string[] = [];
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    tokens.push(scanner.getTokenText());
  }
  // Joined with a space, so every assertion below tolerates whitespace between tokens. The renderer's
  // own dev-only panel prints the literal text `case "{unknown.type}":` — that is JSX text, not code,
  // and it cannot survive as a `case "<slug>":` shape because the interpolation is in the way.
  return tokens.join(" ");
}

const CODE = codeOnly(SRC);

/**
 * type → the component that arm renders. An arm that exists but returns something other than a
 * component is absent from this map on purpose: "has an arm" and "renders its section" are the same
 * claim, and only the first one was ever being checked.
 */
const RENDERS = new Map(
  [...CODE.matchAll(/case\s+"([a-z0-9-]+)"\s*:\s*return\s*<\s*([A-Za-z_][A-Za-z0-9_]*)/g)].map(
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
