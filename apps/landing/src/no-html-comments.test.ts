import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Page-map LP-2: an `.astro` file's `<!-- … -->` is served to the browser — it is not a JavaScript
// comment and `astro build` keeps it. `Base.astro` carried the app's one such comment in every
// page's `<head>`. Section comments are `{/* … */}`, which does not ship. Derived from the
// directory, not a file list, so a new page cannot dodge it.
const SRC = fileURLToPath(new URL(".", import.meta.url));
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".astro") ? [p] : [];
  });

describe("landing .astro files ship no HTML comments", () => {
  it("no <!-- in any .astro under apps/landing/src", () => {
    const offenders = walk(SRC).filter((p) => readFileSync(p, "utf8").includes("<!--"));
    expect(offenders).toEqual([]);
  });
});
