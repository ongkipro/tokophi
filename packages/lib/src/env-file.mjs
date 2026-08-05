// WHERE THIS REPO'S `.env` ACTUALLY IS — and why "the repo root" is not one path.
//
// `.gitignore` is `.env*`, and a git worktree lives at `<main-checkout>/.claude/worktrees/<name>`.
// A worktree therefore **can never carry a `.env`**: it is not tracked, so nothing checks one out and
// nothing copies one in. Every tool here consequently reads TWO files, nearest first — its own root,
// then the main checkout three directories up.
//
// This module exists because that pair had already been written twice and was about to be written a
// third time:
//
//   • `apps/storefront/scripts/check-env.mjs` had it inline, with the worktree reason spelled out.
//   • `test/db-setup.ts` (the vitest `globalSetup`) read ONLY its own root. So in a worktree it found
//     no `DATABASE_URL`, printed its "DB-COUPLED SUITES SKIPPED" banner and exited **0**: measured
//     263 passed / 36 skipped, including all 22 `ledger-credit` tests over the code that decides when
//     a sale becomes withdrawable. The gate built to stop the money suites silently skipping was
//     silently skipping — in the place this repo does nearly all of its work.
//
// A private copy is exactly how the weaker version of a rule survives the fix meant to catch it: see
// the 24-bit password mint in AGENTS.md, which lived through its own guard by being a second copy.
// So there is one resolver, and both callers import it.
//
// ⚠️ `.mjs`, not `.ts`, deliberately: `apps/storefront/scripts/*` run under plain `node` with no
// transpiler, so a `.ts` module could not be shared with them.
//
// ⚠️ The 18 `packages/db` npm scripts encode the SAME pair declaratively —
// `dotenv -e ../../.env -e ../../../../../.env` — because they are shell, not JS, and cannot import
// this. They are the one remaining restatement; if the worktree layout ever changes, they change too.
import fs from "node:fs";
import path from "node:path";

/** The `.env` files a tool rooted at `root` reads, nearest first: its own root, then the main checkout. */
export function envFiles(root) {
  return [path.resolve(root, ".env"), path.resolve(root, "..", "..", "..", ".env")];
}

/**
 * One key: the environment first, then the first `.env` that names it. `undefined` if nothing does.
 *
 * Only single keys are ever wanted here, so this is not a dotenv parser and does not pretend to be
 * one — it does not expand `${VAR}`, and it does not load the file's OTHER keys into `process.env`
 * (which `process.loadEnvFile` did, quietly handing every consumer the whole credential set).
 *
 * @param {string} key   e.g. "DATABASE_URL"
 * @param {string} root  the repo root the caller is running from
 * @returns {string | undefined}
 */
export function readEnvKey(key, root) {
  if (process.env[key]) return process.env[key];
  const re = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=\\s*(.*)$`);
  for (const file of envFiles(root)) {
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue; // absent (the normal worktree case) or unreadable — try the next one
    }
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(re);
      if (!m) continue;
      const value = m[1].trim().replace(/^["']|["']$/g, "");
      if (value) return value;
    }
  }
  return undefined;
}

/** @param {string} root @returns {string | undefined} */
export const readDatabaseUrl = (root) => readEnvKey("DATABASE_URL", root);
