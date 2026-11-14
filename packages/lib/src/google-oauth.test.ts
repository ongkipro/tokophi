import { describe, expect, it } from "vitest";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { authorizeUrl, googleConfig, newOAuthState, stateMatches, verifyIdToken } from "./google-oauth";

const CLIENT = "client-123.apps.googleusercontent.com";

async function keys() {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
  return { privateKey, jwks: createLocalJWKSet({ keys: [jwk] }) };
}
const sign = (key: CryptoKey, claims: Record<string, unknown>, iss = "https://accounts.google.com", aud = CLIENT) =>
  new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(iss).setAudience(aud).setIssuedAt().setExpirationTime("5m").sign(key);

describe("google-oauth (Task 10.12)", () => {
  it("reads config per app redirect variable and is off when anything is missing", () => {
    const env = { GOOGLE_CLIENT_ID: CLIENT, GOOGLE_CLIENT_SECRET: "s", GOOGLE_REDIRECT_URI: "https://app.tokophi.com/api/auth/google/callback", ACCOUNT_GOOGLE_REDIRECT_URI: "http://localhost:4329/auth/google/callback" };
    expect(googleConfig(undefined, env)?.redirectUri).toBe(env.GOOGLE_REDIRECT_URI);
    expect(googleConfig("ACCOUNT_GOOGLE_REDIRECT_URI", env)?.redirectUri).toBe(env.ACCOUNT_GOOGLE_REDIRECT_URI);
    expect(googleConfig("ACCOUNT_GOOGLE_REDIRECT_URI", { ...env, ACCOUNT_GOOGLE_REDIRECT_URI: "" })).toBeNull();
    expect(googleConfig(undefined, { ...env, GOOGLE_CLIENT_SECRET: undefined })).toBeNull();
  });

  it("builds the exact authorize URL the Seller login has always sent", () => {
    const url = authorizeUrl({ clientId: CLIENT, clientSecret: "s", redirectUri: "https://app.tokophi.com/api/auth/google/callback" }, "login.abc");
    expect(url).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth?client_id=client-123.apps.googleusercontent.com" +
        "&redirect_uri=https%3A%2F%2Fapp.tokophi.com%2Fapi%2Fauth%2Fgoogle%2Fcallback&response_type=code" +
        "&scope=openid+email+profile&state=login.abc&access_type=online&prompt=select_account",
    );
  });

  it("state: prefixed 128-bit nonce, and the callback check needs both sides identical", () => {
    const a = newOAuthState("daftar");
    expect(a).toMatch(/^daftar\.[0-9a-f]{32}$/);
    expect(newOAuthState("daftar")).not.toBe(a);
    expect(stateMatches(a, a)).toBe(true);
    expect(stateMatches(a, newOAuthState("daftar"))).toBe(false);
    expect(stateMatches(a, undefined)).toBe(false);
    expect(stateMatches(null, a)).toBe(false);
    expect(stateMatches("", "")).toBe(false);
  });

  it("verifies a good id_token and reports email_verified as given", async () => {
    const { privateKey, jwks } = await keys();
    const ok = await verifyIdToken(await sign(privateKey, { sub: "42", email: "Budi@Example.com", name: "Budi", email_verified: true }), CLIENT, jwks);
    expect(ok).toEqual({ sub: "42", email: "budi@example.com", name: "Budi", emailVerified: true });
    const unverified = await verifyIdToken(await sign(privateKey, { sub: "42", email: "b@x.id", email_verified: false }), CLIENT, jwks);
    expect(unverified?.emailVerified).toBe(false);
    const stringy = await verifyIdToken(await sign(privateKey, { sub: "42", email: "b@x.id", email_verified: "true" }), CLIENT, jwks);
    expect(stringy?.emailVerified).toBe(false); // only a real boolean true counts
  });

  it("rejects wrong audience, wrong issuer, a foreign key, and a token without sub/email", async () => {
    const { privateKey, jwks } = await keys();
    const other = await keys();
    const claims = { sub: "42", email: "b@x.id", email_verified: true };
    expect(await verifyIdToken(await sign(privateKey, claims, undefined, "someone-else"), CLIENT, jwks)).toBeNull();
    expect(await verifyIdToken(await sign(privateKey, claims, "https://evil.example"), CLIENT, jwks)).toBeNull();
    expect(await verifyIdToken(await sign(other.privateKey, claims), CLIENT, jwks)).toBeNull();
    expect(await verifyIdToken(await sign(privateKey, { email: "b@x.id" }), CLIENT, jwks)).toBeNull();
    expect(await verifyIdToken("not-a-jwt", CLIENT, jwks)).toBeNull();
  });
});
