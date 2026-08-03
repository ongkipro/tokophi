import { defineConfig } from "vitest/config";

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
  resolve: {
    alias: {
      "server-only": new URL("./test/stubs/server-only.ts", import.meta.url).pathname,
      // `@/…` is apps/admin's own path alias (its tsconfig maps `@/*` → `./*`). Vitest runs from the
      // repo root and knew nothing about it, so any suite over a `lib/data/*` module died on
      // "Cannot find package '@/lib/tenant'" — which meant the DB-backed data layer was effectively
      // untestable and stayed untested. Admin is the only workspace using this prefix.
      "@/": new URL("./apps/admin/", import.meta.url).pathname,
    },
  },
  test: {
    // Resolves + migrates the throwaway `*_test` database and exports TEST_DATABASE_URL, so the
    // DB-coupled money suites RUN instead of skipping. They skipped by default, which meant 22 tests
    // over the ledger never ran on anyone's machine — and there is no CI here to notice. See the long
    // note in the setup file, especially the guard that refuses any database not named `*_test`.
    globalSetup: ["./test/db-setup.ts"],
  },
});
