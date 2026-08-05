import { readFileSync } from "node:fs";
import { scryptSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { tempPassword, hashPassword } from "@tokophi/lib/password";
import { codeOnly } from "../../../test/source-code";

// The control plane mints logins for OTHER PEOPLE'S accounts — a store owner's, an operator's. A
// fixed password here is not a weak password, it is a published one: `createStore` hashed the literal
// `tokophi123` (printed in this repo and in AGENTS.md) into the OWNER row of every store an operator
// onboarded, so the merchant's email address alone was a working login at app.tokophi.com.
//
// AGENTS.md has stated the rule since the `invitePlatformAdmin` fix — "Never mint a fixed password.
// Random per invite, revealed once" — and `createStore` was still on the constant a week later,
// because nothing failed. This is that failure.
//
// `actions.ts` is `"use server"` and imports `@tokophi/db` at module scope, so it cannot be imported
// here (same reason `platform-rank.ts` was split out). The generator is therefore exercised for real
// through the pure `@tokophi/lib/password` module, and the CALL SITES — where the regression actually
// happened — are checked against the file's source.
//
// ⚠️ HOW STRONG the minted password is, is pinned in `packages/lib/src/password.test.ts`, next to the
// (now single, shared) mint. This file is about WHERE it comes from and whether it reaches the
// operator; that file is about what it costs to guess. Both are load-bearing and neither implies the
// other — the 24-bit version passed every assertion below.
//
// ⚠️ THE SOURCE IS READ AS **CODE**, NOT AS TEXT (`test/source-code.ts`) — and it was wrong in both
// directions until it was. Measured, on this exact file:
//   · Leaving the old signature in a comment above a new one —
//     `// Was: … Promise<{ ok; password?: string }>` over `Promise<{ ok }>` — kept "every action that
//     mints a password hands it back to the operator" GREEN while `createStore` dropped the minted
//     password on the floor. A merchant locked out of a live store, nothing on any screen saying why:
//     AGENTS.md calls that outcome worse than the original bug, and the guard for it was reading a
//     comment.
//   · Writing the sentence AGENTS.md ASKS FOR — a note recording that this used to be
//     `hashPassword(DEV_PASSWORD)` — turned the suite RED over a file with no such call in it. A
//     guard that forbids describing the bug it guards is a guard somebody deletes.
// `codeOnly` is the right half of the pair: every claim below is about what `actions.ts` EXECUTES.
// Tokens come back space-joined, so the patterns are whitespace-tolerant (`password\s*\?\s*:`).
//
// ⚠️ AND IT IS STILL SCOPED TO ONE FILE. That is the same list-binding that let a 24-bit mint survive
// the test written to stop it. The repo-wide half — what `hashPassword()` is fed ANYWHERE — now lives
// in `packages/lib/src/password.test.ts` ("no call site feeds hashPassword a fixed value"), where the
// whole-repo scan already exists. This file keeps the stricter local claim it can only make here:
// that the argument is exactly `pw`, and that `pw` comes from the mint.
const ACTIONS = codeOnly(readFileSync(new URL("./actions.ts", import.meta.url), "utf8"));

// Passwords that are public knowledge: the seed's, and anything ever shipped as a default.
const PUBLISHED = ["tokophi123", "tokophi", "password", "admin123"];

describe("the control plane never mints a fixed password", () => {
  it("tempPassword() is random per call", () => {
    const seen = new Set(Array.from({ length: 500 }, () => tempPassword()));
    // A constant (or a value derived from the input) collapses this to 1.
    expect(seen.size).toBeGreaterThan(400);
    for (const pw of seen) expect(PUBLISHED).not.toContain(pw);
  });

  it("a stored hash never verifies against a published password", () => {
    // What the attack actually is: knowing the merchant's email, try the default. scrypt is
    // deterministic per salt, so this is exactly the check `verifyPassword` runs at login.
    const stored = hashPassword(tempPassword());
    const [salt, hash] = stored.split(":");
    expect(salt).toHaveLength(32);
    for (const guess of PUBLISHED) {
      expect(scryptSync(guess, salt, 64).toString("hex"), `"${guess}" must not open the account`).not.toBe(hash);
    }
  });

  it("every hashPassword() call in actions.ts hashes a freshly minted password", () => {
    // THE class-level rule (AGENTS.md: patch the class, not the instance). `hashPassword(DEV_PASSWORD)`,
    // `hashPassword("tokophi123")` and `hashPassword(input.password)` all fail here — the only thing
    // this file may ever hash is the return of `tempPassword()`, held in `pw` and handed back once.
    const args = [...ACTIONS.matchAll(/hashPassword\s*\(([^)]*)\)/g)].map((m) => m[1].trim());
    expect(args.length, "no password is minted here any more — check this test still points at the right file").toBeGreaterThanOrEqual(5);
    for (const a of args) expect(a, `hashPassword(${a})`).toBe("pw");
    // …and `pw` is only ever assigned from the generator.
    // ⚠️ `[^;]*`, not `(.*)`: `codeOnly` returns the whole file as ONE line, so a greedy `.*` would
    // run to the last `;` in the module and report one assignment of everything.
    const assignments = [...ACTIONS.matchAll(/\bconst\s+pw\s*=\s*([^;]*);/g)].map((m) => m[1].trim());
    expect(assignments.length).toBe(args.length);
    // Compared against the SNIPPET put through the same lexer, so the expectation is written as
    // ordinary source and both sides are spaced identically.
    for (const v of assignments) expect(v).toBe(codeOnly("tempPassword()"));
  });

  it("every action that mints a password hands it back to the operator", () => {
    // A password the UI cannot show is worse than the bug: the merchant is locked out of a live store
    // and nothing on screen says why. Each minting action must return it (the callers surface it —
    // toko-client.tsx / pengaturan-client.tsx / store-detail.tsx show it once).
    for (const fn of ["createStore", "invitePlatformAdmin", "resetOwnerPassword", "resetStoreUserPassword", "addStoreUser", "resetPlatformAdminPassword"]) {
      const sig = new RegExp(`export\\s+async\\s+function\\s+${fn}\\s*\\([^)]*\\)\\s*:\\s*Promise\\s*<([^>]*)>`).exec(ACTIONS);
      expect(sig, `${fn} not found`).not.toBeNull();
      expect(sig![1], `${fn} must return the minted password`).toMatch(/password\s*\?\s*:\s*string/);
    }
  });

  it("no write in actions.ts is anchored to a frozen date", () => {
    // `createStore` stamped `created_at`/`accepted_at` with the seed's ANCHOR (2026-07-02) while
    // computing `trialEndsAt` from the real clock, so a store was born ~30 days old with a 3-day
    // trial. Same class as health.ts and the discount editor's ADMIN_TODAY. The seed may be anchored;
    // the app never is.
    // Listed, not just matched — a failure must name the literal, not print the whole file.
    // Every literal comes back double-quoted from `codeOnly` (a `'…'` and a backticked template
    // alike), so the one quote character below covers all three spellings.
    const frozen = [...ACTIONS.matchAll(/new\s+Date\s*\(\s*"[^)]*\)/g)].map((m) => m[0]);
    expect(frozen).toEqual([]);
  });
});
