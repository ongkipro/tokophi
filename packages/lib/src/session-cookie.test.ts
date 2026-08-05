import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { codeOnly } from "../../../test/source-code";
import { SECURE_COOKIES, sessionCookieOptions } from "./session-cookie";

// ── EVERY SESSION COOKIE IS SET THROUGH ONE HELPER — the SINK, not a list of files ───────────────
//
// Seven hand-written options objects, not one of them with `secure`. The fix is only worth as much
// as its permanence: the eighth call site is written by someone who copies the sixth, so this guard
// scans EVERY TRACKED SOURCE FILE for a write to a session cookie and fails on any that does not go
// through `sessionCookieOptions`. Not a list of seven paths — that is exactly how a 24-bit password
// mint survived its own guard in this repo (CLAUDE.md, "the sink beats the source").
//
// ⚠️ It reads each file's CODE (`test/source-code.ts`), never its text: this very file, and the
// module it guards, both discuss `res.cookies.set(SESSION_COOKIE, …)` in prose, and a guard that
// greps characters would either flag those comments or be tuned until it flagged nothing.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage"]);
const SOURCE = /\.(?:ts|tsx|mts|cts|cjs|astro|mjs|js|jsx)$/;

// Tracked files only, and dot-directories skipped wholesale — `.claude/worktrees/*` on the main
// checkout holds entire second copies of this repo, and another branch's cookie is not ours.
function repoSources(): string[] {
  return execFileSync("git", ["ls-files", "-z"], { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\0")
    .filter(Boolean)
    .filter((rel) => !rel.split("/").some((seg) => seg.startsWith(".") || SKIP_DIRS.has(seg)))
    .filter((rel) => SOURCE.test(rel))
    .map((rel) => path.join(REPO_ROOT, rel));
}

// A write to either session cookie. `codeOnly` joins tokens with single spaces, so the identifier and
// its comma are separated: `set ( SESSION_COOKIE , …`.
const WRITES = /\.\s*set\s*\(\s*(SESSION_COOKIE|PLATFORM_COOKIE)\s*,\s*([^)]*)\)/g;

/**
 * A DELETION is not a session write and must not be forced through the helper.
 *
 * `api/auth/signout` in both apps clears the cookie with `("", { path, maxAge: 0 })`. The browser
 * matches a replacement on name/path/domain — `Secure` is not part of that key — so routing an
 * expiry through `sessionCookieOptions` would add a flag that changes nothing and read as though it
 * mattered. Recognised by the empty value, which is the whole shape of an expiry.
 */
const isDeletion = (args: string) => /^\s*""\s*,/.test(args);

const offenders = () =>
  repoSources().flatMap((abs) => {
    const code = codeOnly(readFileSync(abs, "utf8"));
    return [...code.matchAll(WRITES)]
      .filter((m) => !isDeletion(m[2]) && !/sessionCookieOptions\s*\(/.test(m[2]))
      .map(() => path.relative(REPO_ROOT, abs));
  });

describe("no session cookie is set with hand-written options", () => {
  it("every write in the repo goes through sessionCookieOptions", () => {
    expect(offenders()).toEqual([]);
  });

  // The seven sites that shipped, in SIX files — `apps/super-admin/lib/actions/auth.ts` holds two
  // (operator login and the password re-mint). Named so a future reader can see the guard has a
  // scope, and so deleting a call site does not quietly shrink what is being claimed.
  it("finds all six files it was written for", () => {
    const found = new Set(
      repoSources()
        .filter((abs) => /sessionCookieOptions\s*\(/.test(codeOnly(readFileSync(abs, "utf8"))))
        .map((abs) => path.relative(REPO_ROOT, abs)),
    );
    for (const f of [
      "apps/admin/lib/actions/auth.ts",
      "apps/admin/lib/actions/register.ts",
      "apps/admin/lib/actions/security.ts",
      "apps/admin/app/api/auth/google/callback/route.ts",
      "apps/admin/app/impersonate/route.ts",
      "apps/super-admin/lib/actions/auth.ts",
    ]) {
      expect(found).toContain(f);
    }
  });

  // Prove the scanner can FAIL — a guard nobody has seen red is green for reasons nobody has checked.
  it("goes red on a hand-written options object, and stays quiet on a deletion", () => {
    const bad = codeOnly(`res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax" });`);
    const del = codeOnly(`res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });`);
    const ok = codeOnly(`res.cookies.set(PLATFORM_COOKIE, token, sessionCookieOptions(PLATFORM_MAX_AGE));`);
    const flagged = (s: string) =>
      [...s.matchAll(WRITES)].some((m) => !isDeletion(m[2]) && !/sessionCookieOptions\s*\(/.test(m[2]));
    expect(flagged(bad)).toBe(true);
    expect(flagged(del)).toBe(false);
    expect(flagged(ok)).toBe(false);
  });
});

describe("the flags themselves", () => {
  it("carries every flag a session cookie needs", () => {
    const o = sessionCookieOptions(604_800);
    expect(o).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 604_800 });
    expect(o.secure).toBe(SECURE_COOKIES);
  });

  it("is OFF under vitest and ON in production — the whole point of the expression", () => {
    // Vitest sets NODE_ENV=test, so this run proves the false branch. The true branch is proved by
    // reading the constant's own definition rather than mutating a frozen `process.env` mid-suite.
    expect(SECURE_COOKIES).toBe(false);
    expect(process.env.NODE_ENV).not.toBe("production");
    const src = codeOnly(readFileSync(new URL("./session-cookie.ts", import.meta.url), "utf8"));
    expect(src).toMatch(/SECURE_COOKIES\s*=\s*process\s*\.\s*env\s*\.\s*NODE_ENV\s*===\s*"production"/);
  });
});
