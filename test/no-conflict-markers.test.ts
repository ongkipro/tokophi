import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 2026-08-24: a merge-train resolution COMMITTED conflict markers into BUILD-LOG.md on main — the
// resolving script crashed, and the `&&`-chained `git add && commit && push` behind it shipped the
// half-resolved file anyway. Markdown has no compiler, so nothing red happened anywhere: the ledger
// silently carried `<<<<<<< HEAD` for two merges. This scans every tracked text file, because the
// same slip in a .ts file is a syntax error someone gets to debug, and in a .md it is forever.
describe("no committed conflict markers", () => {
  it("no tracked file carries <<<<<<< / ||||||| / >>>>>>> conflict lines", () => {
    const files = execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean)
      .filter((f) => !/\.(png|webp|jpg|jpeg|gif|ico|woff2?|ttf|pdf|txt)$/i.test(f))
      // this file quotes the markers in its own comment/strings — the one named exception
      .filter((f) => f !== "test/no-conflict-markers.test.ts");
    const bad: string[] = [];
    for (const f of files) {
      let src = "";
      try { src = readFileSync(f, "utf8"); } catch { continue; }
      // Markdown may legitimately QUOTE a conflict inside a fenced code block (the 2026-08-01 audit
      // does exactly that, as evidence). A fence is a quotation; a marker OUTSIDE one is a wound.
      if (f.endsWith(".md")) src = src.replace(/^```[\s\S]*?^```/gm, "");
      // `|||||||` is the diff3 BASE marker. It is the one that SURVIVES a hand-resolution: both
      // 2026-08-24 residues on main were `||||||| 64458fe` lines whose <<<<<<< and >>>>>>> had been
      // resolved away — so a guard matching only those two was green over a wounded ledger. Bare
      // `=======` stays unmatched on purpose (setext underlines / ASCII rules are legal markdown).
      if (/^<{7} |^>{7} |^\|{7}( |$)/m.test(src) || /^<{7}$|^>{7}$/m.test(src)) bad.push(f);
    }
    expect(bad, `conflict markers in: ${bad.join(", ")}`).toEqual([]);
  });
});
