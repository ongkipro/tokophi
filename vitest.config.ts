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
    },
  },
});
