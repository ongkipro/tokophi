import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rateLimit } from "@tokophi/lib/cache";
import { codeOnly } from "../../../test/source-code";

// ── THE SIGNUP DOOR IS METERED, AND IT IS METERED BEFORE IT ANSWERS ──────────────────────────────
//
// `signIn` has been rate-limited since `53dd9ee`; `registerStore` beside it never was, found while
// auditing what opening `SIGNUP_ENABLED` would actually expose. It is the more expensive door of the
// two: a call that gets past the field checks writes SEVEN rows in one transaction and mints a 3-day
// trial.
//
// The half that is easy to miss is the CHEAP path. `registerStore` answers "Email sudah terdaftar.
// Silakan masuk." before it writes anything — correct copy (a returning owner must be told to log in
// rather than stare at a failure), and therefore an **email-existence oracle** over every merchant on
// the platform. Unmetered it is enumerable at request speed. So the ORDER is the claim, not merely
// the presence of a call: the limiter has to run before `emailTaken` and before the scrypt hash, or
// it bounds only the expensive answer and leaves the cheap one wide open.
//
// Read as source because `actions/register.ts` is `"use server"` and pulls `@tokophi/db` through
// `lib/provision` at module scope — importing it needs a live DATABASE_URL, and the fact under test
// is structural. `codeOnly` (never the raw text): a `rateLimit(...)` inside a comment meters nothing.
const REGISTER = join(__dirname, "actions", "register.ts");
const src = () => readFileSync(REGISTER, "utf8");

describe("registerStore is rate limited", () => {
  it("imports the SHARED limiter, not a private copy", () => {
    // One implementation. A second one is how the weaker of a pair survives a fix here — the 24-bit
    // password mint next to the 32-bit one is the case this repo already paid for.
    expect(codeOnly(src())).toMatch(/import\s*\{[^}]*\brateLimit\b[^}]*\}\s*from\s*"@tokophi\/lib\/cache"/);
  });

  it("meters on the client IP, under its own key and its own numbers", () => {
    const code = codeOnly(src());
    // ⚠️ `codeOnly` makes a literal's CONTENTS inert, so the key arrives as `"signup·admin·"` —
    // punctuation gone, words intact. That is enough for the claim being made: the key must not be
    // `login:admin:`. Sharing the login bucket would let a burst of signups lock a merchant out of
    // logging in, and a burst of logins refuse a genuine signup.
    expect(code).toMatch(/rateLimit\s*\(\s*"signup.admin."\s*ip\s*""\s*,\s*5\s*,\s*600_000\s*\)/);
    expect(code).toMatch(/cf.connecting.ip/);
  });

  it("runs BEFORE the email-existence answer and before the password hash", () => {
    const code = codeOnly(src());
    // ⚠️ Compare CALL SITES, not first occurrences — all three names appear in the import block at
    // the top of the file, which is why the naive version of this assertion was red on correct code.
    // `codeOnly` joins tokens with single spaces, so a call is `<name> (`.
    const limit = code.indexOf("rateLimit (");
    const oracle = code.indexOf("emailTaken (");
    const hash = code.indexOf("hashPassword (");
    expect(limit).toBeGreaterThan(-1);
    expect(oracle).toBeGreaterThan(-1);
    expect(hash).toBeGreaterThan(-1);
    expect(limit).toBeLessThan(oracle);
    expect(limit).toBeLessThan(hash);
  });

  // Prove the ordering assertion can go red — a source guard nobody has seen fail is green for
  // reasons nobody has checked (CLAUDE.md, `test/source-code.ts`).
  it("goes red if the limiter is moved below the email check", () => {
    const CALL = "if (!rateLimit(`signup:admin:${ip}`, 5, 600_000).ok) return { error: TOO_MANY_MSG };";
    expect(src()).toContain(CALL); // the mutation is only meaningful if it removes the real line
    const moved = codeOnly(src().replace(CALL, "") + `\n${CALL}`);
    expect(moved.indexOf("rateLimit (")).toBeGreaterThan(moved.indexOf("emailTaken ("));
  });
});

describe("the window the signup limit is configured with", () => {
  // The numbers in `register.ts` (5 per 600_000 ms) only mean anything if the limiter counts the way
  // the comment there claims: a fixed window that refuses the 6th and forgets everything after it.
  it("allows 5 and refuses the 6th within the window", () => {
    const key = `signup-test:${process.pid}:a`;
    for (let i = 0; i < 5; i++) expect(rateLimit(key, 5, 600_000).ok).toBe(true);
    expect(rateLimit(key, 5, 600_000).ok).toBe(false);
  });

  it("is per key, so one abusive IP cannot refuse another's signup", () => {
    const mine = `signup-test:${process.pid}:b`;
    const theirs = `signup-test:${process.pid}:c`;
    for (let i = 0; i < 6; i++) rateLimit(mine, 5, 600_000);
    expect(rateLimit(mine, 5, 600_000).ok).toBe(false);
    expect(rateLimit(theirs, 5, 600_000).ok).toBe(true);
  });
});
