import { describe, expect, it } from "vitest";
import { codeOfFile, isTestFile, SOURCE_SCAN_TIMEOUT_MS, trackedSources } from "./source-code";

// Every shared pagination control must be reachable and activatable from the KEYBOARD.
//
// `PaginationLink` (packages/ui) renders Base UI's Button with `render={<a … {...props} />}`, so an
// `onClick` lands on the <a>, not on Base UI's Enter/Space bridge. An <a> WITHOUT an href is not a
// link to the browser: Enter does nothing, and keyboard users are stuck on page 1. That shipped on
// `/files` (PR #429, caught by review 2026-11-06) and had already shipped on `/pesanan`.
//
// Accepted shapes, per opening tag: an `href=` prop, an `onKeyDown=` handler (update-log's explicit
// Enter/Space bridge), or a props spread `{...x}` that supplies them (checked by its call sites'
// reviewers, not here). Code only — comments and strings are stripped before matching.
const TAG = /<\s*Pagination(?:Link|Previous|Next)\b/g; // codeOnly() joins tokens with spaces: "< PaginationLink"

/** The opening tag starting at `from`, up to its closing `>` at JSX-brace depth 0. */
function openingTag(code: string, from: number): string {
  let depth = 0;
  for (let i = from + 1; i < code.length; i++) {
    const c = code[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return code.slice(from, i + 1);
  }
  return code.slice(from);
}

export function keyboardDeadPaginationTags(code: string): string[] {
  const dead: string[] = [];
  for (const m of code.matchAll(TAG)) {
    const tag = openingTag(code, m.index!);
    if (/\bhref\s*=/.test(tag) || /\bonKeyDown\s*=/.test(tag) || /\{\s*\.\.\./.test(tag)) continue;
    dead.push(tag.replace(/\s+/g, " ").slice(0, 160));
  }
  return dead;
}

describe("pagination controls are keyboard-activatable", () => {
  it("the detector itself: href-less onClick is dead; href, onKeyDown and spreads pass", () => {
    expect(keyboardDeadPaginationTags(`<PaginationLink isActive={a} onClick={() => go(p)}>{p}</PaginationLink>`)).toHaveLength(1);
    expect(keyboardDeadPaginationTags(`<PaginationNext text="x" onClick={() => go({ page: 2 })} />`)).toHaveLength(1);
    expect(keyboardDeadPaginationTags(`<PaginationLink href={h(p)} onClick={(e) => jump(e, p)}>{p}</PaginationLink>`)).toEqual([]);
    expect(keyboardDeadPaginationTags(`<PaginationLink isActive={a} {...goTo(p)}>{p}</PaginationLink>`)).toEqual([]);
    expect(keyboardDeadPaginationTags(`<PaginationPrevious onKeyDown={k} onClick={c} />`)).toEqual([]);
    // The shape the scan really sees: codeOnly() output, tokens joined by single spaces.
    expect(keyboardDeadPaginationTags(`< PaginationLink isActive = { p === page } onClick = { ( ) => go ( { page : p } ) } >`)).toHaveLength(1);
  });

  it(
    "no tracked app source renders an href-less, key-less pagination control",
    () => {
      const offenders: string[] = [];
      for (const rel of trackedSources()) {
        if (!rel.startsWith("apps/") || !rel.endsWith(".tsx") || isTestFile(rel)) continue;
        for (const tag of keyboardDeadPaginationTags(codeOfFile(rel))) offenders.push(`${rel}: ${tag}`);
      }
      expect(offenders).toEqual([]);
    },
    SOURCE_SCAN_TIMEOUT_MS,
  );
});
