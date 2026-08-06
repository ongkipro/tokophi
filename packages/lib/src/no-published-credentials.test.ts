import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SOURCE_SCAN_TIMEOUT_MS, textOfFile } from "../../../test/source-code";

// NO SHIPPED SCREEN MAY NAME AN ACCOUNT THAT AUTHENTICATES.
//
// Both login pages published one. `rich.tokophi.com/login` — the CONTROL PLANE, which reaches every
// store on the platform — printed `admin@tokophi.id / tokophi123` and pre-filled that address into
// the email field; the Seller panel did the same with the seeded owner. **The seed genuinely creates
// those rows on deploy**, so neither was a placeholder: they were working credentials, on the public
// internet, on the page that accepts them.
//
// `#133` fixed the half that MINTS (`createStore` no longer hashes a fixed password). It did nothing
// about the account the seed creates and the login page advertised — the visible half survived the
// invisible one's fix, which is the same shape as the 24-bit mint that survived its own guard.
//
// ⚠️ WHY A SOURCE SCAN AND NOT A UNIT TEST: there is no function to call. The defect is a string in
// JSX, and it comes back as a "dev convenience" — which is exactly why it was there the first time.
// It scans EVERY app source file rather than a list of two, because a list of two is how a copy
// survives (see `password.test.ts`, which learned the same lesson).

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const APPS = join(ROOT, "apps");

// The seeded logins. Both are real rows after `npm run seed`.
//
// ⚠️ WHITESPACE-TOLERANT ON PURPOSE — this is not decoration, it is the HTML-comment case.
// `textWithoutComments` re-emits LEXER TOKENS joined by single spaces. Inside a string literal the
// address survives verbatim as one token (`"admin@tokophi.id"`); inside JSX text or an HTML comment
// the same characters lex as `admin @ tokophi . id`. A tight `/admin@tokophi\.id/` would therefore
// have caught the string and walked past `<!-- admin@tokophi.id -->`, which is the one shape this
// file's HTML-comment rule exists for. Measured, not assumed.
const SECRETS = [
  { pattern: /tokophi123/, what: "the seeded password" },
  { pattern: /admin\s*@\s*tokophi\s*\.\s*id/, what: "the seeded PLATFORM operator address" },
  { pattern: /ongki\s*@\s*batiknusantara\s*\.\s*id/, what: "the seeded store owner address" },
];

// ⚠️ COMMENTS ARE STRIPPED BEFORE MATCHING, and that is a deliberate line.
// The rule is that no SHIPPED SCREEN may name a credential — a `//` or `/* */` comment never reaches
// one. And the comments that name `tokophi123` are the ones EXPLAINING the fix (`actions.ts` records
// that `createStore` used to hash it); a guard that forbids describing the bug it guards would get
// deleted the first time someone needed to write that sentence.
//
// ⚠️ HTML comments are NOT stripped, on purpose: `<!-- … -->` in an `.astro` file IS served to the
// browser, so a credential in one really is published. (This repo has already been bitten by an
// Astro-comment subtlety — see the note in `checkout.astro` about `{/* … */}` rendering as text.)
// `textWithoutComments` keeps them — verified, and pinned by `test/source-code.test.ts`.
//
// ── WHY `textWithoutComments` AND NOT `codeOnly` ─────────────────────────────────────────────────
// This is the one file in the repo where the DEFAULT is the wrong half of the pair. The thing being
// hunted lives INSIDE a string literal — `defaultValue="admin@tokophi.id"`, a `Dev:` line in JSX —
// and `codeOnly` makes every literal's contents inert, which would delete the evidence and leave a
// permanently green guard over a published credential. Both functions drop `//` and `/* */`, which
// is the half this file needs; only one of them keeps the string.
//
// ── WHAT IT REPLACED, AND WHY THE HAND-ROLLED VERSION WAS NOT A SMALL BUG ────────────────────────
// Two regexes: `s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")`.
//   · The `[^:]` saves `https://` and NOTHING ELSE. Any other `//` in a string — a
//     protocol-relative `"//cdn.tokophi.com/logo.png"`, a path, a `//` in prose — deleted the rest
//     of ITS OWN LINE, credential included.
//   · Worse, a `/*` inside a string ate everything up to the next `*/` ANYWHERE IN THE FILE. An
//     ordinary glob (`"src/pages/**/*.astro"`) plus one ordinary block comment further down is
//     enough. Measured on a page shaped like the ones we ship: all THREE secrets vanished — the
//     `tokophi123` line, the owner address, and the `<!-- admin@tokophi.id -->` HTML comment this
//     file's own rule is about — and all five tests stayed green.
// That is the same class as the bug this file guards, one layer down: a regex deciding what is a
// comment cannot tell a comment from characters that look like one. A lexer can — a comment is
// trivia, so there is nothing to strip and nothing to get wrong.
//
// ⚠️ ONE HOLE SURVIVES, MEASURED, AND IT IS THE SAME SIZE AS BEFORE — not a regression, but write it
// down rather than discover it twice. The lexer reads an `.astro`/`.tsx` file as JavaScript, so `//`
// in raw MARKUP TEXT still starts a line comment to it: `<p>buka //rich.tokophi.com dengan
// tokophi123</p>` loses the rest of that line. The old `[^:]` regex lost it too (the character before
// `//` is a space, not a colon), so nothing got worse — and every shape actually shipped here put the
// credential in a string, an attribute, plain text or an HTML comment, all four of which are caught.
// Closing it means teaching the scanner where an Astro template's text nodes are, which is a parser,
// not a lexer, and `test/source-code.ts` explains at length why this repo does not build one.
function sources(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (["node_modules", ".next", "dist"].includes(e.name)) continue;
      // ⚠️ `public` IS SKIPPED ONLY AS AN APP'S ASSET DIRECTORY (`apps/<app>/public`). Skipping it by
      // NAME at any depth — which is what this did — also hid `apps/admin/app/api/public`, the PUBLIC
      // API: four route files, unscanned for this guard's whole life. That is the same blind spot as
      // a hardcoded file list, spelled differently, and `inventory-location.test.ts` had it too (its
      // sweep could not see the very route that once held the copy it hunts).
      if (e.name === "public" && p.slice(APPS.length + 1).split("/").length === 2) continue;
      sources(p, acc);
    } else if (/\.(tsx|ts|astro)$/.test(e.name) && !/\.test\.ts$/.test(e.name)) {
      acc.push(p);
    }
  }
  return acc;
}

describe("no shipped screen publishes a working credential", () => {
  const files = sources(APPS);
  // Lexed ONCE. `it.each(SECRETS)` runs the sweep three times, and re-lexing 453 files per pattern
  // cost ~1,5 s of the suite for three identical answers. The memo now lives in
  // `test/source-code.ts` next to the lexer itself — this file kept a private one, which is a second
  // answer to a question that already had one, and a second answer is what this module exists to end.
  const code = textOfFile;

  it("scans a meaningful number of files (the scan itself must not silently find nothing)", () => {
    // A guard that walks an empty tree passes forever. Pin that it actually looked.
    expect(files.length).toBeGreaterThan(200);
  });

  // ⏱ 2.699 ms of real work: the FIRST of the three patterns lexes all 455 files and the rest hit
  // the memo. The measured profile and why a ceiling is not the fix are in ONE place —
  // `SOURCE_SCAN_TIMEOUT_MS` in `test/source-code.ts`. Do not copy the number here.
  it.each(SECRETS)("no app source names $what", ({ pattern }) => {
    const hits = files
      .filter((f) => pattern.test(code(f)))
      .map((f) => f.slice(APPS.length + 1));
    expect(hits).toEqual([]);
  }, SOURCE_SCAN_TIMEOUT_MS);

  it("neither login page pre-fills an email address", () => {
    // The password line is the obvious half; `defaultValue` on the email input is the half that was
    // missed when this was first reported — it publishes WHICH account to attack, and the login
    // limiter is keyed on IP, not on account, so nothing records that one operator is being tried.
    for (const rel of ["admin/app/login/login-form.tsx", "super-admin/app/login/page.tsx"]) {
      // Same helper as the sweep above: the claim is about the input the browser RENDERS, and a
      // `defaultValue` inside a `{/* … */}` explaining why there must not be one is not one.
      const src = code(join(APPS, rel));
      const emailInput = src.match(/<\s*Input[^>]*\bname\s*=\s*"email"[^>]*>/)?.[0] ?? "";
      // A matcher that matches NOTHING passes forever — the same failure mode the file-count
      // assertion above exists for. Rename the component and this claim must go red, not quiet.
      expect(emailInput, `${rel}: no <Input name="email"> found — has it been renamed?`).not.toBe("");
      expect(emailInput, `${rel}: email input`).not.toContain("defaultValue");
    }
  });
});
