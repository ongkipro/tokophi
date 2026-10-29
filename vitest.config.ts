import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

// The repo runs vitest with no config, which is fine until a test needs a module that only Next
// provides. `server-only` is such a module: it is not an npm dependency here — Next aliases it during
// its own build — so importing any `apps/admin/lib/*` file that guards itself with it fails to resolve
// under plain vitest.
//
// Aliasing it to an empty stub is the smallest fix, and it is honest: the marker exists to make a
// build fail if server code is pulled into a client bundle, which is a bundling concern with no meaning
// inside a Node test runner. The alternative — splitting every server-only module in two so the pure
// half is testable — moves secret-handling code around for a test's convenience, and `crypto.ts` is
// exactly the file where that trade is worst.
export default defineConfig({
  // The AUTOMATIC JSX runtime, because that is the one Next actually compiles these files with.
  // `packages/ui/tsconfig.json` says `"jsx": "preserve"` — correct for a library whose consumer does
  // the transform — and esbuild reads that and falls back to the CLASSIC runtime, i.e. bare
  // `React.createElement`. The result is a split that has nothing to do with the component: files
  // that happen to `import * as React` render fine under vitest (`input.tsx`, `textarea.tsx`) and
  // files that do not throw `ReferenceError: React is not defined` (`switch.tsx`, `checkbox.tsx`) —
  // so a rendered test could cover half of `@tokophi/ui` and no one would know why.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "server-only": fileURLToPath(new URL("./test/stubs/server-only.ts", import.meta.url)),
      // `@/…` is apps/admin's own path alias (its tsconfig maps `@/*` → `./*`). Vitest runs from the
      // repo root and knew nothing about it, so any suite over a `lib/data/*` module died on
      // "Cannot find package '@/lib/tenant'" — which meant the DB-backed data layer was effectively
      // untestable and stayed untested. Admin is the only workspace using this prefix.
      "@/": fileURLToPath(new URL("./apps/admin/", import.meta.url)),
    },
  },
  test: {
    // Resolves + migrates the throwaway `*_test` database and exports TEST_DATABASE_URL, so the
    // DB-coupled money suites RUN instead of skipping. They skipped by default, which meant 22 tests
    // over the ledger never ran on anyone's machine — and there is no CI here to notice. See the long
    // note in the setup file, especially the guard that refuses any database not named `*_test`.
    globalSetup: ["./test/db-setup.ts"],
    // Vitest's defaults skip node_modules/dist/.git but NOT `.claude/`, and `.claude/worktrees/*` holds
    // dozens of stale agent checkouts, each a full copy of the tree. Measured 2026-09-04: a bare
    // `npx vitest run` collected 3603 files (the repo has ~135), took 15 minutes, and 68 files failed —
    // every copy racing the others for the one `_test` database. Same trap `scripts/gen-page-map.mjs`
    // hit on its first run.
    exclude: [...configDefaults.exclude, "**/.claude/**"],
    // Vitest's 5 s / 10 s defaults are too tight for this suite on a shared machine: the source
    // guards walk the whole tree and the DB suites migrate and seed. Measured 2026-10-29 at load
    // average ~28 (other agents' builds and browsers): `page-map-fresh` and `cname-target` timed out
    // at 5 s and `public/order` at its 10 s hook, then passed in isolation. Still bounded — a hang fails.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
