import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SECTIONS_BY_TEMPLATE_TYPE, SECTION_DEFAULTS, type SectionType } from "@tokophi/sections";

// `SectionRenderer.astro` is the ONLY thing that turns a saved `page_templates.sections[].type` into
// pixels. It had 14 `case` arms, no `default:` and no exhaustiveness assertion, so **a type added to
// `SectionConfigMap` and forgotten compiled and rendered nothing** — part of a merchant's published
// page disappeared with no error and no failed build.
//
// The compile-time half of the fix is `const _exhaustive: never = item` in the `default:` arm. This
// test exists because nothing in this repo RUNS the compiler over that file: the storefront's build
// is a bare `astro build` (transpile-only) and `astro check` is not wired into any script, any CI or
// any `npm test`. A gate that does not run is not a gate — the same lesson as the 22 ledger tests
// that skipped for weeks. `npx vitest run` does run.
//
// Note which list is authoritative. `SECTION_DEFAULTS` is typed `SectionConfigMap`, so TypeScript
// requires an entry for EVERY `SectionType` — its keys are the complete union at runtime.
// `SECTION_TYPES` (the builder sidebar's order) is a plain `SectionType[]` and can legally omit one.

const SRC = readFileSync(
  fileURLToPath(new URL("./SectionRenderer.astro", import.meta.url)),
  "utf8",
);

const ALL_TYPES = Object.keys(SECTION_DEFAULTS).sort() as SectionType[];

// Matches a real `case "…":` arm. The prose above the `default:` arm talks about case arms but never
// spells one with a literal quoted type, and the dev-warning markup renders `case "{unknown.type}":`
// — an interpolation, not a match for this pattern.
const ARMS = [...SRC.matchAll(/case\s+"([a-z0-9-]+)"\s*:/g)].map((m) => m[1]).sort();

describe("SectionRenderer covers every section type", () => {
  it("has a case arm for every key of SectionConfigMap", () => {
    // Adding a type to `SectionConfigMap` (and therefore to `SECTION_DEFAULTS`, which tsc forces)
    // without an arm here fails RIGHT NOW, not on a live storefront.
    expect(ARMS).toEqual(ALL_TYPES);
  });

  it("keeps the compile-time exhaustiveness assertion", () => {
    // The `never` assignment is what makes the omission a compile error under `astro check`. It is
    // one "unused variable" cleanup away from being deleted, and the deletion is silent.
    expect(SRC).toMatch(/default:\s*\{/);
    expect(SRC).toMatch(/const _exhaustive: never = item;/);
  });

  it("an unknown type is reported, never silently dropped", () => {
    // The runtime half: a type this deploy does not know (an older saved template, a rolled-back
    // deploy) must leave a trace. Server warning always — this is SSR, so it reaches the container
    // log; visible panel in DEV only, because a shopper must not be shown our internal error on a
    // merchant's live shop.
    expect(SRC).toMatch(/console\.warn\(/);
    expect(SRC).toMatch(/import\.meta\.env\.DEV/);
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
