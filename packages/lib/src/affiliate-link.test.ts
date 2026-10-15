import { describe, expect, it } from "vitest";
import { AFFILIATE_LINK_TTL_SEC, affiliateLinkSecret, issueAffiliateLink, verifyAffiliateLink } from "./affiliate-link";

const S = "b".repeat(32) + "-affiliate-link-secret";
const AFF = "3f1e2d4c-5b6a-4789-8abc-def012345678";
const STORE = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-2222-4333-8444-555555555555";
const T0 = 1_760_000_000_000;

describe("affiliate-link (F-A18)", () => {
  it("secret below 32 chars is off", () => {
    expect(affiliateLinkSecret({})).toBeNull();
    expect(affiliateLinkSecret({ AFFILIATE_LINK_SECRET: "short" })).toBeNull();
    expect(affiliateLinkSecret({ AFFILIATE_LINK_SECRET: S })).toBe(S);
    expect(() => issueAffiliateLink(AFF, STORE, "")).toThrow();
    const t = issueAffiliateLink(AFF, STORE, S, T0);
    expect(verifyAffiliateLink(t, "", T0)).toBeNull();
    expect(verifyAffiliateLink(t, S.slice(0, 31), T0)).toBeNull();
  });

  it("round-trips and binds the store", () => {
    const t = issueAffiliateLink(AFF, STORE, S, T0);
    expect(verifyAffiliateLink(t, S, T0, STORE)).toEqual({ affiliateId: AFF, storeId: STORE, issuedAt: T0 / 1000 });
    expect(verifyAffiliateLink(t, S, T0, OTHER)).toBeNull();
  });

  it("rejects tampering, a wrong secret and non-canonical encodings", () => {
    const t = issueAffiliateLink(AFF, STORE, S, T0);
    const [p, m] = t.split(".");
    const forged = Buffer.from(`${AFF}.${OTHER}.${T0 / 1000}`).toString("base64url");
    expect(verifyAffiliateLink(`${forged}.${m}`, S, T0)).toBeNull();
    expect(verifyAffiliateLink(`${p}.${m.slice(0, -2)}AA`, S, T0)).toBeNull();
    expect(verifyAffiliateLink(t, S + "x", T0)).toBeNull();
    expect(verifyAffiliateLink(`${p}=.${m}`, S, T0)).toBeNull();
    expect(verifyAffiliateLink(` ${t}`, S, T0)).toBeNull();
    expect(verifyAffiliateLink("", S, T0)).toBeNull();
    expect(verifyAffiliateLink(`${t}.x`, S, T0)).toBeNull();
  });

  it("expires after 90 days and refuses future-dated tokens beyond 60 s", () => {
    const t = issueAffiliateLink(AFF, STORE, S, T0);
    expect(verifyAffiliateLink(t, S, T0 + AFFILIATE_LINK_TTL_SEC * 1000)).not.toBeNull();
    expect(verifyAffiliateLink(t, S, T0 + (AFFILIATE_LINK_TTL_SEC + 1) * 1000)).toBeNull();
    expect(verifyAffiliateLink(t, S, T0 - 60_000)).not.toBeNull();
    expect(verifyAffiliateLink(t, S, T0 - 61_000)).toBeNull();
  });

  it("rejects non-uuid ids at issue", () => {
    expect(() => issueAffiliateLink("nope", STORE, S)).toThrow();
    expect(() => issueAffiliateLink(AFF, "nope", S)).toThrow();
  });
});
