import { describe, expect, it } from "vitest";
import { SOURCE_SCAN_TIMEOUT_MS, codeOfFile, isTestFile, trackedSources } from "../../../test/source-code";
import { ENV_CHECKS, checkEnv } from "./env-health";

// ── THE CENSUS: EVERY VARIABLE THE CODE READS IS CLASSIFIED, OR THIS GOES RED ────────────────────
//
// `lib/env-health.ts` is only worth having if it cannot fall behind the code. A hand-kept list is
// exactly the thing that rots — so this derives the truth from the SINK (`process.env.X` in the
// source) and fails until somebody says whether the new variable is required or optional. Same shape
// as `rbac-census.test.ts`, which does it for capabilities, and for the same reason: a new entry
// must cost a decision, not a silent default.
//
// ⚠️ `codeOnly`, never the raw text: `process.env.FOO` inside a comment reads nothing, and this file
// itself is full of variable names in prose.
const ROUTE = "apps/admin/app/api/health/env/route.ts";

// Runtime-only names: set by the platform or by a test harness, never by an operator in Coolify, and
// therefore not something an env health check should ask about. Named explicitly — the rule in this
// repo is scan everything and name your exceptions.
const NOT_OPERATOR_SET = new Set([
  "TEST_DATABASE_URL", // vitest globalSetup exports it
  "TEST_DB_REQUIRED", // `npm run test:db`
  "SEED_FORCE", // packages/db seeding flags, CLI-only
  "SEED_DESTROY_CONFIG",
  "SEED_OWNER_PASSWORD",
  "DRY_RUN", // ops scripts
  "CHECK_BASE_URL", // storefront check harness
]);

// `trackedSources()` is the ONE lister; the prefixes below are this guard's scope and nothing else.
// A test is out of scope on purpose — vitest's own `process.env` reads are not the admin's runtime
// environment, and asking an operator to classify `TEST_DB_REQUIRED` is how a census gets ignored.
function envNamesReadBy(dirs: string[]): string[] {
  const files = trackedSources().filter(
    (rel) => dirs.some((d) => rel.startsWith(`${d}/`)) && /\.tsx?$/.test(rel) && !isTestFile(rel),
  );
  const found = new Set<string>();
  for (const rel of files) {
    // `codeOnly` joins tokens with single spaces, so the member access arrives spaced out.
    for (const m of codeOfFile(rel).matchAll(/process\s*\.\s*env\s*\.\s*([A-Z][A-Z0-9_]*)/g)) found.add(m[1]);
  }
  return [...found].filter((n) => !NOT_OPERATOR_SET.has(n)).sort();
}

describe("every env var the admin reads is classified", () => {
  it("finds them from the source, not from a list somebody remembered to update", () => {
    const read = envNamesReadBy(["apps/admin"]);
    // A sanity floor: if this drops to nothing the scanner broke, and the test would pass vacuously.
    expect(read.length).toBeGreaterThan(8);
    const unclassified = read.filter((n) => !(n in ENV_CHECKS));
    expect(unclassified, `classify these in lib/env-health.ts: ${unclassified.join(", ")}`).toEqual([]);
  }, SOURCE_SCAN_TIMEOUT_MS);

  it("classifies the ones the SHARED packages read too — they run inside this process", () => {
    // `@tokophi/lib` and `@tokophi/db` are imported by the admin, so their env is the admin's env.
    // `AUTH_SECRET` and `INTEGRATION_TOKEN_KEY` live there, and both are required.
    const read = envNamesReadBy(["packages/lib/src", "packages/db/src"]);
    const unclassified = read.filter((n) => !(n in ENV_CHECKS));
    expect(unclassified, `classify these in lib/env-health.ts: ${unclassified.join(", ")}`).toEqual([]);
  }, SOURCE_SCAN_TIMEOUT_MS);

  it("keeps the required set honest — the four that stop the app dead", () => {
    // Not "some are required": these specific ones, because each has a failure this repo has met.
    for (const n of ["DATABASE_URL", "AUTH_SECRET", "CRON_SECRET", "KIRIMINAJA_ENV"]) {
      expect(ENV_CHECKS[n]?.required, `${n} must stay required`).toBe(true);
    }
    // …and the ones whose EMPTY state is a deliberate product decision must NOT be required, or the
    // check screams every day about a closed signup and a hidden Google button.
    for (const n of ["SIGNUP_ENABLED", "GOOGLE_CLIENT_ID"]) {
      expect(ENV_CHECKS[n]?.required, `${n} must stay optional`).toBe(false);
    }
  });

  it("treats a whitespace-only value as MISSING", () => {
    // Coolify writes `VAR: ''` when a value has not arrived — which is exactly the 5 August failure.
    // "Defined" is not the question an operator is asking.
    const prev = process.env.KIRIMINAJA_ENV;
    try {
      process.env.KIRIMINAJA_ENV = "   ";
      expect(checkEnv().missing).toContain("KIRIMINAJA_ENV");
      process.env.KIRIMINAJA_ENV = "sandbox";
      expect(checkEnv().missing).not.toContain("KIRIMINAJA_ENV");
    } finally {
      if (prev === undefined) delete process.env.KIRIMINAJA_ENV;
      else process.env.KIRIMINAJA_ENV = prev;
    }
  });
});

describe("the health route never reports a value", () => {
  it("reads process.env only for its own gate", () => {
    // Presence is a fact an operator needs; the value is one screenshot from being leaked, and half
    // this list is credentials. The route may read CRON_SECRET (its gate) and NODE_ENV (fail-closed);
    // anything else means a value is being touched inside the responder.
    const code = codeOfFile(ROUTE);
    const names = [...code.matchAll(/process\s*\.\s*env\s*\.\s*([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]);
    expect([...new Set(names)].sort()).toEqual(["CRON_SECRET", "NODE_ENV"]);
    // And it must never index the environment dynamically, which would slip past the check above.
    expect(code).not.toMatch(/process\s*\.\s*env\s*\[/);
  });
});
