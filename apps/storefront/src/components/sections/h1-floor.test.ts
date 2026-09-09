import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { codeOnly, textWithoutComments } from "../../../../../test/source-code";

// The homepage's `<h1>` floor rests on ONE fact: `Hero` is the only section that emits an `<h1>`.
//
// `index.astro` renders a visually-hidden `<h1>` when a merchant's Store Builder homepage contains no
// `hero` section — otherwise that page ships with no top-level heading at all. The moment another
// section starts emitting an `<h1>`, that condition is wrong in the expensive direction: the floor
// would keep firing and the page would carry TWO `<h1>`s, which is the defect it exists to prevent.
//
// Nothing else can see this. The template is merchant data, so a build renders whatever the demo store
// happens to have saved, and `astro check` has no opinion about heading levels.

const SECTIONS = fileURLToPath(new URL(".", import.meta.url));
const INDEX = fileURLToPath(new URL("../../pages/index.astro", import.meta.url));
const LANDING = fileURLToPath(new URL("../../pages/lp/[slug].astro", import.meta.url));

// ⚠️ THIS FILE HAND-ROLLED ITS OWN COMMENT STRIPPER, AND THEN DID NOT USE IT ON HALF THE FILE.
//
// `stripComments` knew about `{/* */}` and `<!-- -->` and nothing else, and the `index.astro`
// assertions below were matched against RAW text anyway. So commenting the floor out —
// `{/* {!TEMPLATE_HAS_HEADING && <h1 class="sr-only">…} */}` — left all three tests green over a
// homepage that ships with NO top-level heading whenever the merchant's template has no hero. It is
// the same defect as `cart-variant.test.ts` and `section-renderer-exhaustive.test.ts`, in a third
// guard, hand-rolled a third way.
//
// The rule and its one implementation are in `test/source-code.ts` — and THE TWO HALVES OF THIS FILE
// WANT DIFFERENT ANSWERS FROM IT, which is exactly why that module exports two functions:
//
//  · The `<h1>` SWEEP uses `textWithoutComments`. A `<h1>` concatenated into a JS string and assigned
//    to `innerHTML` is an emitted `<h1>` — the search palette's whole `<img>` exists that way (see
//    CLAUDE.md). Inerting literals here would turn a real second heading into a green run.
//  · The PREDICATE assertions use `codeOnly`. They are claims about what the page executes, and a
//    commented-out or stringified floor executes nothing.
//
// The expected snippets go through `codeOnly` too, so they can be written as ordinary source instead
// of as hand-loosened regexes — one normalisation, applied to both sides, and no `\s*` to forget.
const asCode = codeOnly;

describe("the homepage h1 floor", () => {
  it("Hero is the only section component that emits an <h1>", () => {
    const emitters = readdirSync(SECTIONS)
      .filter((f) => f.endsWith(".astro"))
      // `< h1` as well as `<h1`: a lexer separates the tokens of real JSX, while markup inside a
      // string keeps whatever spelling it was written with.
      // ⚠️ `<!-- … -->` is NOT stripped — it is not a JavaScript comment, and an `.astro` file's HTML
      // comments are served to the browser verbatim (same fact `no-published-credentials.test.ts`
      // depends on). So an `<h1>` written inside one would be flagged here. That is the right
      // trade: write section comments as `{/* … */}`, which is the Astro-idiomatic form and does not
      // ship at all.
      .filter((f) => /<\s*h1[\s>]/.test(textWithoutComments(readFileSync(join(SECTIONS, f), "utf8"))));
    expect(emitters).toEqual(["Hero.astro"]);
  });

  it("index.astro renders the floor, and only when no hero is in the template", () => {
    const src = codeOnly(readFileSync(INDEX, "utf8"));
    // The predicate must key on the same section type the test above pinned…
    expect(src).toContain(asCode("const TEMPLATE_HAS_HEADING = !!HOMEPAGE_TEMPLATE?.content.some("));
    expect(src).toContain(asCode(`s.type === "hero"`));
    expect(src).toContain(asCode(`{!TEMPLATE_HAS_HEADING && <h1 class="sr-only">`));
  });

  // Page-map SF-9: the custom-HTML landing has the same problem with no template to inspect — the
  // merchant's pasted markup and OrderFunnel both may carry no heading — so its floor is
  // unconditional. A claim about what the page executes → codeOnly.
  it("lp/[slug].astro renders an unconditional sr-only <h1> from the landing title", () => {
    expect(codeOnly(readFileSync(LANDING, "utf8"))).toContain(asCode(`<h1 class="sr-only">{landing.title}</h1>`));
  });

  // The floor and Hero's own `<h1>` are two halves of ONE predicate: "does a slide have a heading".
  // `heroSlides()` keeps a slide with an `imageUrl` and no heading, so a hero CAN carry no words —
  // and `s.type === "hero"` alone would then suppress the floor over a page with nothing to head it.
  // If either half stops asking about the heading text, the pair silently disagrees: zero `<h1>` on a
  // pictorial hero, or two on an ordinary one. Both are green in the build, lint and `astro check`.
  it("both halves key on a slide that actually has a heading", () => {
    expect(codeOnly(readFileSync(INDEX, "utf8"))).toContain(
      asCode(`heroSlides(s.props).some((sl) => (sl.heading ?? "").trim() !== "")`),
    );
    const hero = codeOnly(readFileSync(join(SECTIONS, "Hero.astro"), "utf8"));
    expect(hero).toContain(asCode(`HEADING_INDEX = slides.findIndex((s) => (s.heading ?? "").trim() !== "")`));
    // …and exactly one slide may render as the heading.
    expect(hero).toContain(asCode("i === HEADING_INDEX ?"));
  });
});
