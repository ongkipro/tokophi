import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./source-code";

// Astro 7's build/server output does `import { parseCookie, stringifySetCookie } from "cookie"` and
// leaves it EXTERNAL, so Node resolves it from the app's own directory upward. In this monorepo the
// hoisted root `cookie` is 0.7.x (express, pulled in by the shadcn CLI) which has no such named
// exports: `astro build` (docs, landing) and the storefront SERVER fail with "Named export
// 'parseCookie' not found" — a green `astro check` and a green `tsc` say nothing about it (found
// 2026-11-02 moving Astro 5 → 7). The fix is a direct `cookie@^2` in every Astro app, so it lands in
// `apps/<app>/node_modules`. This guard keeps the next dependency refresh from deleting it.
const ASTRO_APPS = ["storefront", "landing", "docs"];

describe("every Astro app declares its own cookie@2", () => {
  for (const app of ASTRO_APPS) {
    it(`apps/${app}`, () => {
      const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "apps", app, "package.json"), "utf8"));
      const range: string | undefined = pkg.dependencies?.cookie;
      expect(range, "cookie must be a direct dependency").toBeTruthy();
      expect(Number(/(\d+)/.exec(range!)?.[1])).toBeGreaterThanOrEqual(2);
    });
  }
  it("the list is complete: every apps/* with astro as a dependency is named above", () => {
    const withAstro = readdirSync(join(REPO_ROOT, "apps")).filter((a) => {
      const f = join(REPO_ROOT, "apps", a, "package.json");
      return existsSync(f) && JSON.parse(readFileSync(f, "utf8")).dependencies?.astro;
    });
    expect(withAstro.sort()).toEqual([...ASTRO_APPS].sort());
  });
});
