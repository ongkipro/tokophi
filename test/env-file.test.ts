import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { envFiles, readDatabaseUrl } from "@tokophi/lib/env-file";
import { codeOnly } from "./source-code";

// THE GATE THAT WAS BUILT TO STOP SILENT SKIPPING WAS SILENTLY SKIPPING.
//
// `test/db-setup.ts` derives `<DATABASE_URL>_test`, creates it, migrates it and lets the money suites
// run by default. It read `<its own root>/.env` — but `.gitignore` is `.env*`, so a git worktree
// (`<main>/.claude/worktrees/<name>`) can never carry one. Measured in a worktree before the fix:
// **263 passed / 36 skipped, exit 0**, with all 22 `ledger-credit` tests — the code that decides when
// a sale becomes withdrawable — among the skipped. With `DATABASE_URL` exported: 299 passed, 0 skipped.
//
// Two claims here, because the defect had two halves:
//   1. the fallback to the MAIN CHECKOUT's `.env` works — delete the second entry of `envFiles()` and
//      this goes red;
//   2. it is reached through the SHARED module — the fallback already existed, correctly, a few files
//      over in `apps/storefront/scripts/check-env.mjs`, and db-setup had a private copy that did not
//      have it. A private copy is how the weaker rule survives the fix (see the 24-bit mint in
//      AGENTS.md), so re-inlining either lookup goes red too.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");

let sandbox: string;
/** `<sandbox>/main` — stands in for the main checkout, and it is the only one with a `.env`. */
let main: string;
/** `<sandbox>/main/.claude/worktrees/w-test` — stands in for a worktree, which never has one. */
let worktree: string;

beforeAll(() => {
  sandbox = mkdtempSync(path.join(tmpdir(), "tokophi-env-file-"));
  main = path.join(sandbox, "main");
  worktree = path.join(main, ".claude", "worktrees", "w-test");
  mkdirSync(worktree, { recursive: true });
  writeFileSync(path.join(main, ".env"), 'AUTH_SECRET=irrelevant\nDATABASE_URL="postgres://u@localhost:5433/main_db"\n');
});
afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

describe("the .env a worktree cannot have", () => {
  it("falls back to the MAIN CHECKOUT's .env when the worktree has none", () => {
    delete process.env.DATABASE_URL;
    expect(readDatabaseUrl(worktree)).toBe("postgres://u@localhost:5433/main_db");
  });

  it("prefers the tool's OWN root when it does have one", () => {
    delete process.env.DATABASE_URL;
    writeFileSync(path.join(worktree, ".env"), "DATABASE_URL=postgres://u@localhost:5433/wt_db\n");
    try {
      expect(readDatabaseUrl(worktree)).toBe("postgres://u@localhost:5433/wt_db");
    } finally {
      rmSync(path.join(worktree, ".env"));
    }
  });

  it("an explicit environment variable still wins over both files", () => {
    process.env.DATABASE_URL = "postgres://u@localhost:5433/from_env";
    try {
      expect(readDatabaseUrl(worktree)).toBe("postgres://u@localhost:5433/from_env");
    } finally {
      delete process.env.DATABASE_URL;
    }
  });

  it("reads ONLY the key asked for — no other .env value leaks into process.env", () => {
    delete process.env.DATABASE_URL;
    delete process.env.AUTH_SECRET;
    readDatabaseUrl(worktree);
    expect(process.env.AUTH_SECRET).toBeUndefined();
  });

  it("returns undefined when nothing names it — the SKIP banner, not a throw", () => {
    delete process.env.DATABASE_URL;
    expect(readDatabaseUrl(path.join(sandbox, "nowhere"))).toBeUndefined();
  });

  it("looks exactly three levels up — the depth of .claude/worktrees/<name>", () => {
    expect(envFiles(worktree)).toEqual([path.join(worktree, ".env"), path.join(main, ".env")]);
  });
});

describe("one resolver, not a third private copy", () => {
  // Reads the files' CODE, never their text (`test/source-code.ts`): the prose above and in both
  // targets talks about `.env` constantly, and a comment is not a lookup.
  const sources = {
    "test/db-setup.ts": path.join(REPO, "test/db-setup.ts"),
    "apps/storefront/scripts/check-env.mjs": path.join(REPO, "apps/storefront/scripts/check-env.mjs"),
  };

  for (const [name, file] of Object.entries(sources)) {
    it(`${name} resolves DATABASE_URL through @tokophi/lib/env-file`, () => {
      const code = codeOnly(readFileSync(file, "utf8"));
      expect(code).toMatch(/@tokophi\s*\/\s*lib\s*\/\s*env-file/);
      // The two shapes of "I found my own .env": a literal filename, or the loader that takes one.
      expect(code).not.toMatch(/"\s*\.env\s*"|'\s*\.env\s*'|loadEnvFile/);
    });
  }
});
