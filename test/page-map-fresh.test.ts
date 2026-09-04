import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// `specs/docs/PAGE_MAP.md` is generated from the source tree. A generated document that is not
// regenerated is a hand-written one with a misleading header — which is how `CODE_MAP.md` came to
// say "39 routes" over a directory holding 55. Same shape as `route-roles.test.ts`: the page list is
// derived from the DIRECTORY, so a new `page.tsx` goes red here until someone runs the generator.
const ROOT = fileURLToPath(new URL("..", import.meta.url));

describe("specs/docs/PAGE_MAP.md", () => {
  it("matches what scripts/gen-page-map.mjs derives from the tree (run: node scripts/gen-page-map.mjs)", () => {
    expect(() => execFileSync(process.execPath, ["scripts/gen-page-map.mjs", "--check"], { cwd: ROOT, stdio: "pipe" })).not.toThrow();
  });
});
