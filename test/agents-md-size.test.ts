import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// AGENTS.md (CLAUDE.md is a symlink to it) is loaded in full into every AI session, and Claude Code
// warns above 150k chars. It hit 155.9k on 2026-10-28 and the long sections moved to
// specs/docs/rules/. This fails long BEFORE the limit so the next incident goes into a rules file,
// with only its one-line rule left in AGENTS.md.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const agents = readFileSync(path.join(ROOT, "AGENTS.md"), "utf8");
const LIMIT = 90_000;

describe("AGENTS.md stays small enough to load every session", () => {
  it(`is under ${LIMIT} chars`, () => {
    expect(
      agents.length,
      `AGENTS.md is ${agents.length} chars (Claude Code warns at 150k). Move incident detail to the matching ` +
        `specs/docs/rules/*.md and keep only the one-line rule here. Do not raise the limit.`,
    ).toBeLessThan(LIMIT);
  });

  it("every specs/docs/rules/ file it points to exists", () => {
    const named = [...agents.matchAll(/specs\/docs\/rules\/([\w.-]+\.md)/g)].map((m) => m[1]);
    expect(named.length).toBeGreaterThan(5); // a regex that matches nothing would pass vacuously
    for (const f of new Set(named)) {
      expect(existsSync(path.join(ROOT, "specs/docs/rules", f)), `AGENTS.md points to a missing rules file: ${f}`).toBe(true);
    }
  });
});
