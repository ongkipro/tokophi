// Preload for `ops/mengantar-sandbox-e2e.ts` ONLY (run with NODE_OPTIONS="--import <abs path>"). The admin modules it drives start with
// `import "server-only"` — a marker Next aliases during its own build; it is not an npm package here,
// so plain Node cannot resolve it. Map it to the same empty stub vitest uses (test/stubs/server-only.ts).
// `registerHooks` (Node ≥ 22.15) covers both `import` and `require`, whichever tsx emits.
import { registerHooks } from "node:module";

const STUB = new URL("../test/stubs/server-only.ts", import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: STUB, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
