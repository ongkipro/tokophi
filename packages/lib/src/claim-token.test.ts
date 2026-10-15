import { describe, expect, it } from "vitest";
import { CLAIM_TOKEN_TTL_SEC, claimSecret, issueClaimToken, verifyClaimToken } from "./claim-token";

const S = "a".repeat(32) + "-claim-secret-for-tests";
const A = "6f1c2d3e-4a5b-4c6d-8e7f-0123456789ab";
const B = "7f1c2d3e-4a5b-4c6d-8e7f-0123456789ab";
const T0 = Date.UTC(2026, 9, 15, 12);

describe("claim-token (Task 10.13, D-3)", () => {
  it("secret: unset or shorter than 32 chars means the feature is off", () => {
    expect(claimSecret({})).toBeNull();
    expect(claimSecret({ ACCOUNT_CLAIM_SECRET: "short" })).toBeNull();
    expect(claimSecret({ ACCOUNT_CLAIM_SECRET: S })).toBe(S);
  });

  it("verifies for its own order, and only that order", () => {
    const t = issueClaimToken(A, S, T0);
    expect(verifyClaimToken(t, S, T0)).toEqual({ orderId: A, issuedAt: T0 / 1000 });
    expect(verifyClaimToken(t, S, T0, A)).not.toBeNull();
    expect(verifyClaimToken(t, S, T0, B)).toBeNull();
    expect(verifyClaimToken(issueClaimToken(B, S, T0), S, T0, A)).toBeNull();
  });

  it("expires after 30 days and refuses a future-dated token", () => {
    const t = issueClaimToken(A, S, T0);
    expect(verifyClaimToken(t, S, T0 + CLAIM_TOKEN_TTL_SEC * 1000)).not.toBeNull();
    expect(verifyClaimToken(t, S, T0 + (CLAIM_TOKEN_TTL_SEC + 1) * 1000)).toBeNull();
    expect(verifyClaimToken(issueClaimToken(A, S, T0 + 5 * 60_000), S, T0)).toBeNull();
  });

  it("fails on a different secret and on every single flipped character", () => {
    const t = issueClaimToken(A, S, T0);
    expect(verifyClaimToken(t, S + "x", T0)).toBeNull();
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    for (let i = 0; i < t.length; i++) {
      if (t[i] === ".") continue;
      const swap = alphabet[(alphabet.indexOf(t[i]) + 1) % alphabet.length];
      expect(verifyClaimToken(t.slice(0, i) + swap + t.slice(i + 1), S, T0), `flip at ${i}`).toBeNull();
    }
  });

  it("a payload re-signed with another order id is still refused without the secret", () => {
    const [, sig] = issueClaimToken(A, S, T0).split(".");
    const forgedPayload = Buffer.from(`${B}.${T0 / 1000}`).toString("base64url");
    expect(verifyClaimToken(`${forgedPayload}.${sig}`, S, T0)).toBeNull();
  });

  it("rejects malformed input and refuses to issue for a non-uuid", () => {
    for (const bad of ["", ".", "a.b.c", "abc", "%%%.%%%"]) expect(verifyClaimToken(bad, S, T0)).toBeNull();
    expect(verifyClaimToken(undefined as unknown as string, S, T0)).toBeNull();
    expect(() => issueClaimToken("ORD-1001", S, T0)).toThrow();
  });
});
