import { describe, expect, it } from "vitest";
import { CLOSED_PAGE, HEALTH_PATH, claimAvailable, closedRewrite, signInAvailable } from "./availability";

// The production state on deploy day (BUYER-ACCOUNT-DEPLOY): a production build, NODE_ENV=production,
// AUTH_SECRET set, no Google client, no claim secret.
const PROD = { NODE_ENV: "production", AUTH_SECRET: "x".repeat(40) };
const GOOGLE = {
  GOOGLE_CLIENT_ID: "id.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "s",
  ACCOUNT_GOOGLE_REDIRECT_URI: "https://account.tokophi.com/auth/google/callback",
};

describe("Akun TokoΦ is closed until a sign-in method exists", () => {
  it("is closed in production without Google — every page goes to the one closed page", () => {
    expect(signInAvailable(PROD, true)).toBe(false);
    for (const p of ["/", "/masuk", "/klaim", "/orders", "/orders/TP-1/receipt", "/auth/google/start", "/keluar", "/nope"]) {
      expect(closedRewrite(p, PROD, true), p).toBe(CLOSED_PAGE);
    }
  });

  it("keeps the healthcheck and the closed page itself reachable (no rewrite loop, container stays healthy)", () => {
    expect(closedRewrite(HEALTH_PATH, PROD, true)).toBeNull();
    expect(closedRewrite(CLOSED_PAGE, PROD, true)).toBeNull();
  });

  it("needs ALL THREE Google values — the redirect var is the account's own, not Seller's", () => {
    expect(signInAvailable({ ...PROD, ...GOOGLE }, true)).toBe(true);
    expect(closedRewrite("/masuk", { ...PROD, ...GOOGLE }, true)).toBeNull();
    const { ACCOUNT_GOOGLE_REDIRECT_URI: _drop, ...noRedirect } = GOOGLE;
    expect(signInAvailable({ ...PROD, ...noRedirect }, true)).toBe(false);
    expect(signInAvailable({ ...PROD, ...noRedirect, GOOGLE_REDIRECT_URI: "https://app.tokophi.com/api/auth/google/callback" }, true)).toBe(false);
  });

  it("stays open for local development (the email form) and never for a production build", () => {
    expect(signInAvailable({ NODE_ENV: "development" }, false)).toBe(true);
    expect(signInAvailable({ NODE_ENV: "development" }, true)).toBe(false);
  });
});

describe("/klaim needs the claim secret on top", () => {
  it("is closed with no secret or a short one, open with ≥ 32 chars", () => {
    expect(claimAvailable({})).toBe(false);
    expect(claimAvailable({ ACCOUNT_CLAIM_SECRET: "short" })).toBe(false);
    expect(claimAvailable({ ACCOUNT_CLAIM_SECRET: "c".repeat(32) })).toBe(true);
  });
});
