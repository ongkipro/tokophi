import { describe, expect, it } from "vitest";
import {
  GRANT_TOKEN_BYTES,
  GRANT_TTL_SECONDS,
  IMPERSONATION_SESSION_EXPIRY,
  IMPERSONATION_SESSION_MAX_AGE,
  grantExpiresAt,
  grantTokenHash,
  mintGrantToken,
} from "./impersonation";

// The pure half of the impersonation exchange. The DATABASE half — spend once, refuse replay,
// refuse expiry, refuse a demoted operator — is `apps/admin/lib/impersonation.test.ts`, against real
// Postgres. What is provable here is the shape of the handle and the arithmetic around it.

describe("the exchange handle is opaque, and wide enough to be unguessable", () => {
  it("carries no claims — it is 256 random bits and nothing else", () => {
    const token = mintGrantToken();
    // base64url of 32 bytes: 43 characters, no padding, URL-safe alphabet only. If this ever starts
    // matching `^ey` again, somebody has put a JWT back in the query string (Task 4.11 / SEC-10).
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(token).not.toContain(".");
    expect(GRANT_TOKEN_BYTES * 8).toBe(256);
  });

  it("is fresh every time — a handle is never derived from the store, the operator or the clock", () => {
    // 500 mints, zero collisions. A weak generator (a timestamp, a counter, a store id) fails here
    // long before it fails in production. This is the same claim `password.test.ts` makes about the
    // credential mint, for the same reason: entropy is the only wall this credential has.
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(mintGrantToken());
    expect(seen.size).toBe(500);
  });
});

describe("only the digest is ever stored", () => {
  it("hashes deterministically, so the two apps agree byte for byte", () => {
    const token = mintGrantToken();
    expect(grantTokenHash(token)).toBe(grantTokenHash(token));
    expect(grantTokenHash(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a single changed character is a completely different digest — this is what makes TAMPER fail closed", () => {
    const token = mintGrantToken();
    // Flip the first character to something else in the same alphabet.
    const tampered = (token[0] === "A" ? "B" : "A") + token.slice(1);
    expect(tampered).not.toBe(token);
    expect(grantTokenHash(tampered)).not.toBe(grantTokenHash(token));
  });

  it("the digest does not contain the handle — a dump of the table is worth nothing", () => {
    const token = mintGrantToken();
    expect(grantTokenHash(token)).not.toContain(token);
  });
});

describe("the two bounded windows", () => {
  it("a handle expires 120 seconds after it is minted", () => {
    const now = new Date("2026-08-21T10:00:00.000Z");
    expect(grantExpiresAt(now).toISOString()).toBe("2026-08-21T10:02:00.000Z");
    expect(GRANT_TTL_SECONDS).toBe(120);
  });

  // ⚠️ THE COOKIE AND THE TOKEN MUST NOT DRIFT. `IMPERSONATION_SESSION_EXPIRY` is the jose form of
  // `IMPERSONATION_SESSION_MAX_AGE`, and it is DERIVED so that editing one edits both. If somebody
  // "tidies" it into a literal ("30m"), this is the test that notices the day the other one moves.
  it("the impersonated session is bounded at 30 minutes, expressed once", () => {
    expect(IMPERSONATION_SESSION_MAX_AGE).toBe(1800);
    expect(IMPERSONATION_SESSION_EXPIRY).toBe(`${IMPERSONATION_SESSION_MAX_AGE}s`);
    // Far short of the merchant's own 7 days — that comparison is the entire point of the constant.
    expect(IMPERSONATION_SESSION_MAX_AGE).toBeLessThan(60 * 60 * 24 * 7);
  });
});
