import { readFileSync } from "node:fs";
import { scryptSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { tempPassword, hashPassword } from "./temp-password";

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
// through the pure `./temp-password` module, and the CALL SITES — where the regression actually
// happened — are checked against the file's source.

const ACTIONS = readFileSync(new URL("./actions.ts", import.meta.url), "utf8");

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
    const args = [...ACTIONS.matchAll(/hashPassword\(([^)]*)\)/g)].map((m) => m[1].trim());
    expect(args.length, "no password is minted here any more — check this test still points at the right file").toBeGreaterThanOrEqual(5);
    for (const a of args) expect(a, `hashPassword(${a})`).toBe("pw");
    // …and `pw` is only ever assigned from the generator.
    const assignments = [...ACTIONS.matchAll(/const pw = (.*);/g)].map((m) => m[1].trim());
    expect(assignments.length).toBe(args.length);
    for (const v of assignments) expect(v).toBe("tempPassword()");
  });

  it("every action that mints a password hands it back to the operator", () => {
    // A password the UI cannot show is worse than the bug: the merchant is locked out of a live store
    // and nothing on screen says why. Each minting action must return it (the callers surface it —
    // toko-client.tsx / pengaturan-client.tsx / store-detail.tsx show it once).
    for (const fn of ["createStore", "invitePlatformAdmin", "resetOwnerPassword", "resetStoreUserPassword", "addStoreUser"]) {
      const sig = new RegExp(`export async function ${fn}\\([^)]*\\)\\s*:\\s*Promise<([^>]*)>`).exec(ACTIONS);
      expect(sig, `${fn} not found`).not.toBeNull();
      expect(sig![1], `${fn} must return the minted password`).toMatch(/password\?: string/);
    }
  });

  it("no write in actions.ts is anchored to a frozen date", () => {
    // `createStore` stamped `created_at`/`accepted_at` with the seed's ANCHOR (2026-07-02) while
    // computing `trialEndsAt` from the real clock, so a store was born ~30 days old with a 3-day
    // trial. Same class as health.ts and the discount editor's ADMIN_TODAY. The seed may be anchored;
    // the app never is.
    // Listed, not just matched — a failure must name the literal, not print the whole file.
    const frozen = [...ACTIONS.matchAll(/new Date\(\s*["'`][^)]*\)/g)].map((m) => m[0]);
    expect(frozen).toEqual([]);
  });
});
