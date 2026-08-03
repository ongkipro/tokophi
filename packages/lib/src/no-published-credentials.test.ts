import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

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
const SECRETS = [
  { pattern: /tokophi123/, what: "the seeded password" },
  { pattern: /admin@tokophi\.id/, what: "the seeded PLATFORM operator address" },
  { pattern: /ongki@batiknusantara\.id/, what: "the seeded store owner address" },
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
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function sources(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (["node_modules", ".next", "dist", "public"].includes(e.name)) continue;
      sources(p, acc);
    } else if (/\.(tsx|ts|astro)$/.test(e.name) && !/\.test\.ts$/.test(e.name)) {
      acc.push(p);
    }
  }
  return acc;
}

describe("no shipped screen publishes a working credential", () => {
  const files = sources(APPS);

  it("scans a meaningful number of files (the scan itself must not silently find nothing)", () => {
    // A guard that walks an empty tree passes forever. Pin that it actually looked.
    expect(files.length).toBeGreaterThan(200);
  });

  it.each(SECRETS)("no app source names $what", ({ pattern }) => {
    const hits = files
      .filter((f) => pattern.test(stripComments(readFileSync(f, "utf8"))))
      .map((f) => f.slice(APPS.length + 1));
    expect(hits).toEqual([]);
  });

  it("neither login page pre-fills an email address", () => {
    // The password line is the obvious half; `defaultValue` on the email input is the half that was
    // missed when this was first reported — it publishes WHICH account to attack, and the login
    // limiter is keyed on IP, not on account, so nothing records that one operator is being tried.
    for (const rel of ["admin/app/login/login-form.tsx", "super-admin/app/login/page.tsx"]) {
      const src = readFileSync(join(APPS, rel), "utf8");
      const emailInput = src.match(/<Input[^>]*name="email"[^>]*>/)?.[0] ?? "";
      expect(emailInput, `${rel}: email input`).not.toContain("defaultValue");
    }
  });
});
