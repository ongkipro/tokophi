#!/usr/bin/env node
// verify:source-size — the GUARD half of Task 6.6 / NF-12. The split itself is a separate, risky
// refactor that waits on Tasks 5.4 and 5.6 (Cross-Lane Contract 5/6 in TASKS.md); this file only
// stops the two release-critical modules from GROWING while they wait.
//
// THE CEILING IS THE MEASURED SIZE, NOT A TARGET. Both numbers are `wc -l` on the shared worktree
// on 2026-09-09 (branch `feat/sweep-0909`, main 74d7744) — the same day both files had ALREADY
// grown past the sizes TASKS.md recorded the day before (2789 → 2841 → 2864, 1552 → 1582).
// ⚠️ `checkout.astro` was 2841 at HEAD and 2864 in the working tree when this was written: another
// stream's uncommitted edit (+23) was in flight, and the ceiling is the tree, not HEAD, so that
// stream is not the first thing this guard blocks. If that edit never lands, LOWER it to 2841.
// A ceiling set lower than the file would fail on the first run and be scrolled past, which is how
// `verify-rls` sat red for weeks; a ceiling set at the file means the next line added to either
// module is a red gate, and the author has to say why. (The count is the number of `\n` bytes,
// exactly what `wc -l` prints.)
//
// UPGRADE PATH — when Task 6.6 lands its extraction:
//   1. lower the ceiling of the split file to its NEW measured size (never leave the old headroom:
//      the guard would then permit the file to grow back to where it was), and
//   2. add the extracted modules here ONLY if they are themselves release-critical entry points —
//      the point is the two entry files, not a size cap on every file in the tree.
// Lowering a ceiling is always allowed. Raising one is a deliberate change that belongs in the same
// commit as the code that needs it, with the reason in the commit body.
//
// Usage: node scripts/verify-source-size.mjs [--ceiling <path>:<lines>]...
//   --ceiling  replace the table below (used by test/release-guards.test.ts to prove the guard red)
// Exit 0 = every file at or under its ceiling, 1 = at least one file over, 2 = usage/missing file.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, isAbsolute } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const CEILINGS = {
  "apps/storefront/src/pages/checkout.astro": 2864,
  "apps/admin/app/(admin)/produk/[id]/product-editor.tsx": 1582,
};

const args = process.argv.slice(2);
let table = CEILINGS;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--ceiling") {
    if (table === CEILINGS) table = {};
    const spec = args[++i] ?? "";
    const at = spec.lastIndexOf(":");
    const n = Number(spec.slice(at + 1));
    if (at < 1 || !Number.isInteger(n) || n < 0) {
      console.error(`--ceiling wants <path>:<lines>, got "${spec}"`);
      process.exit(2);
    }
    table[spec.slice(0, at)] = n;
  } else {
    console.error(`unknown argument: ${args[i]}`);
    process.exit(2);
  }
}

const lineCount = (text) => (text.match(/\n/g) ?? []).length;

let over = 0;
console.log("verify:source-size — release-critical entry files may not grow (Task 6.6 guard)");
for (const [rel, ceiling] of Object.entries(table)) {
  const file = isAbsolute(rel) ? rel : join(ROOT, rel);
  if (!existsSync(file)) {
    console.error(`  ! ${rel}: file not found — the table names a file that no longer exists; update the table`);
    process.exit(2);
  }
  const lines = lineCount(readFileSync(file, "utf8"));
  const ok = lines <= ceiling;
  if (!ok) over++;
  console.log(`  ${ok ? "ok " : "OVER"} ${rel}: ${lines} lines (ceiling ${ceiling}${ok ? "" : `, +${lines - ceiling}`})`);
}
if (over) {
  console.log(`\n${over} file(s) over the ceiling. Extract, do not append — see the header of scripts/verify-source-size.mjs.`);
  process.exit(1);
}
