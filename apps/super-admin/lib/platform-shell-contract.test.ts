import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { codeOnly, textWithoutComments } from "../../../test/source-code";

// The control plane's SHELL and FRONT DOOR — two defects measured in a browser on 2026-09-11 and
// fixed the same day, pinned so they cannot quietly return:
//
//  · Below `md` the sidebar is `hidden` and, until that day, NOTHING replaced it: an operator on a
//    phone had a header, a page, and no way to reach any other page. The mobile drawer is the fix,
//    and it is CONTROLLED so a nav tap closes it (an uncontrolled drawer navigates underneath and
//    stays open — the Seller topbar paid for that lesson first).
//  · The root layout applied a saved theme before paint, but no control could change it.
//
// Source claims, because a hidden control is invisible to every type-checker and to a screenshot
// taken at one width. Each carries a mutation self-check so it cannot be green for want of matching.
// TWO readings of the shell, chosen PER ASSERTION (AGENTS.md): `codeOnly` for what the file
// executes (literals inert, so a claim can never be satisfied by a comment or a string), and
// `textWithoutComments` for the one claim about MARKUP it emits — a Tailwind class list lives inside
// a string literal, which `codeOnly` would turn into `md·flex`. Tokens are space-joined by both, so
// every pattern below is whitespace-tolerant: `< h1`, `< ThemeToggle / >`.
const SHELL_SRC = readFileSync(new URL("../app/(platform)/platform-shell.tsx", import.meta.url), "utf8");
const SHELL = codeOnly(SHELL_SRC);
const SHELL_TEXT = textWithoutComments(SHELL_SRC);
const LOGIN = textWithoutComments(readFileSync(new URL("../app/login/page.tsx", import.meta.url), "utf8"));

describe("platform shell", () => {
  it("offers a mobile drawer below md, controlled by state", () => {
    expect(SHELL).toMatch(/SheetTrigger/);
    expect(SHELL).toMatch(/Sheet\s+open\s*=\s*\{\s*mobileMenu\s*\}\s+onOpenChange\s*=\s*\{\s*setMobileMenu\s*\}/);
    expect(SHELL).toMatch(/onNavigate\s*=\s*\{\s*\(\s*\)\s*=>\s*setMobileMenu\s*\(\s*false\s*\)\s*\}/);
    // the trigger must be the thing that HIDES on md, mirroring the sidebar that SHOWS on md
    expect(SHELL_TEXT).toMatch(/aside\s+className\s*=\s*"[^"]*\bhidden\b[^"]*\bmd:flex\b/);
    const uncontrolled = /<\s*Sheet\s*>/;
    expect(SHELL).not.toMatch(uncontrolled);
    expect(codeOnly("<Sheet><SheetTrigger /></Sheet>")).toMatch(uncontrolled); // self-check
  });

  it("renders a theme toggle and shows the operator's rank, not a decorative badge", () => {
    expect(SHELL).toMatch(/function\s+ThemeToggle/);
    expect(SHELL).toMatch(/<\s*ThemeToggle\s*\/\s*>/);
    expect(SHELL).toMatch(/RANK_LABEL\s*\[\s*admin\s*\.\s*role\s*\]/);
    // the ornament that was removed: a gradient card that said "Platform" under the nav
    // a MARKUP claim — the class list is a string literal, so it is read with literals kept
    const ornament = /bg-gradient-to-br\s+from-primary\/10/;
    expect(SHELL_TEXT).not.toMatch(ornament);
    expect(textWithoutComments('<div className="rounded-xl border bg-gradient-to-br from-primary/10 to-primary/5 p-3">')).toMatch(ornament);
  });

  it("renders ONE nav list for both the sidebar and the drawer", () => {
    expect((SHELL.match(/<\s*NavLinks\b/g) ?? []).length).toBe(2);
  });
});

describe("super-admin login (front door)", () => {
  it("has exactly one h1, a 44px primary action, and never pre-fills an account", () => {
    expect((LOGIN.match(/<\s*h1\b/g) ?? []).length).toBe(1);
    expect(LOGIN).toMatch(/type\s*=\s*"submit"[^>]*className\s*=\s*"[^"]*\bh-11\b/);
    expect(LOGIN).not.toMatch(/defaultValue/);
    // the error gets a surface with role="alert" — bare red text reads as a label on a two-field form
    expect(LOGIN).toMatch(/role\s*=\s*"alert"/);
  });
});
