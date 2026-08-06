import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { codeOnly } from "../../../test/source-code";

// A CHECK THAT IS NOT IN THE RUNNER IS NOT A CHECK.
//
// `check-search-srcset.mjs` shipped outside `CHECKS`, in the very wave that converged every other
// script onto `check-env.mjs`. So `npm run verify` ran five of six, the search-palette fix had a guard
// nobody ran, and the file kept its own `T_URL`/`DPR` with a sixth default port — which made
// AGENTS.md's "the old `T_URL` / `H1_PORT` / `DPR` are retired and now fail loudly" FALSE for exactly
// the check that wave added. The loud failure lives in `check-env.mjs`; a script that never imports it
// cannot fail loudly, it just connects to the wrong port and reports confident nonsense.
//
// Nobody notices an omission from an array. So the array is derived from the directory instead — add
// a `check-*.mjs` and this goes red until it is wired up. Same lesson as `verify-rls`: a gate that
// does not run is not a gate.
//
// It reads `run-checks.mjs`'s CODE, not its text (`test/source-code.ts`) — a commented-out entry is
// an entry that does not run, and that is the whole family of defect this file belongs to.

const SCRIPTS = fileURLToPath(new URL(".", import.meta.url));
const CODE = codeOnly(readFileSync(join(SCRIPTS, "run-checks.mjs"), "utf8"));

/** `check-env.mjs` is the shared contract module, not a check — it has no assertions of its own. */
const ON_DISK = readdirSync(SCRIPTS)
  .filter((f) => /^check-.+\.mjs$/.test(f) && f !== "check-env.mjs")
  .map((f) => f.replace(/\.mjs$/, ""))
  .sort();

const REGISTERED = [
  ...CODE.matchAll(/\{\s*name\s*:\s*"(check-[a-z0-9-]+)"\s*,\s*server\s*:\s*(true|false)\s*\}/g),
].map((m) => ({ name: m[1], server: m[2] === "true" }));

describe("the storefront check suite", () => {
  // Every assertion below is driven by these two lists, and `toEqual([])` / `toEqual(ON_DISK)` are
  // both satisfied by an empty one. A renamed convention on either side (the `check-*.mjs` glob, or
  // the `{ name, server }` shape the runner registers) would empty it and turn all three green over
  // a suite that runs nothing — the exact vacuous pass this file was written to stop, one level up.
  it("found the checks at all, on disk AND in the runner", () => {
    expect(ON_DISK.length, "no check-*.mjs on disk — has the naming convention changed?").toBeGreaterThan(4);
    expect(REGISTERED.length, "run-checks.mjs registers none — has the CHECKS entry shape changed?").toBeGreaterThan(4);
  });

  it("runs every check in the folder", () => {
    expect(REGISTERED.map((c) => c.name).sort()).toEqual(ON_DISK);
  });

  it("gives every check that needs a server the ONE invocation contract", () => {
    // `check-image-widths` is `server: false` — disk versus disk, so it needs no base URL and
    // legitimately does not import the module. Everything else must, or it is inventing a sixth
    // convention and `check-env.mjs`'s retired-variable guard cannot fire for it.
    const missing = REGISTERED.filter(
      (c) =>
        c.server &&
        !codeOnly(readFileSync(join(SCRIPTS, `${c.name}.mjs`), "utf8")).includes('from "./check-env.mjs"'),
    );
    expect(missing.map((c) => c.name)).toEqual([]);
  });

  it("leaves no check reading a variable check-env.mjs has retired", () => {
    // The retired names fail loudly ONLY inside `check-env.mjs`. A script that reads one directly has
    // reintroduced the knob under the guard's nose — which is exactly what `check-search-srcset` did.
    const RETIRED = /process\s*\.\s*env\s*\.\s*(T_URL|H1_PORT|DPR)\b/;
    const offenders = ON_DISK.filter((n) => RETIRED.test(codeOnly(readFileSync(join(SCRIPTS, `${n}.mjs`), "utf8"))));
    expect(offenders).toEqual([]);
  });
});
