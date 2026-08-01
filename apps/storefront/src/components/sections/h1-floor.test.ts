import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

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

// Astro files carry both comment syntaxes and Multicolumn *discusses* `<h1>` in prose. Strip comments
// before looking for markup, or the guard fails on a file that is merely explaining itself.
const stripComments = (src: string) =>
  src.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/<!--[\s\S]*?-->/g, "");

describe("the homepage h1 floor", () => {
  it("Hero is the only section component that emits an <h1>", () => {
    const emitters = readdirSync(SECTIONS)
      .filter((f) => f.endsWith(".astro"))
      .filter((f) => /<h1[\s>]/.test(stripComments(readFileSync(join(SECTIONS, f), "utf8"))));
    expect(emitters).toEqual(["Hero.astro"]);
  });

  it("index.astro renders the floor, and only when no hero is in the template", () => {
    const src = readFileSync(INDEX, "utf8");
    // The predicate must key on the same section type the test above pinned…
    expect(src).toMatch(/TEMPLATE_HAS_HEADING\s*=\s*!!HOMEPAGE_TEMPLATE\?\.content\.some\(/);
    expect(src).toMatch(/s\.type === "hero"/);
    expect(src).toMatch(/!TEMPLATE_HAS_HEADING && <h1 class="sr-only">/);
  });

  // The floor and Hero's own `<h1>` are two halves of ONE predicate: "does a slide have a heading".
  // `heroSlides()` keeps a slide with an `imageUrl` and no heading, so a hero CAN carry no words —
  // and `s.type === "hero"` alone would then suppress the floor over a page with nothing to head it.
  // If either half stops asking about the heading text, the pair silently disagrees: zero `<h1>` on a
  // pictorial hero, or two on an ordinary one. Both are green in the build, lint and `astro check`.
  it("both halves key on a slide that actually has a heading", () => {
    expect(readFileSync(INDEX, "utf8")).toMatch(/heroSlides\(s\.props\)\.some\(\(sl\) => \(sl\.heading \?\? ""\)\.trim\(\) !== ""\)/);
    const hero = readFileSync(join(SECTIONS, "Hero.astro"), "utf8");
    expect(hero).toMatch(/HEADING_INDEX = slides\.findIndex\(\(s\) => \(s\.heading \?\? ""\)\.trim\(\) !== ""\)/);
    // …and exactly one slide may render as the heading.
    expect(hero).toMatch(/i === HEADING_INDEX \?/);
  });
});
