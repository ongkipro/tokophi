import { randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

// Google Sign-In (OAuth 2.0 authorization-code flow, plain fetch — no extra deps). Shared by the
// Seller panel and the buyer account (Task 10.12, spec §17 D-2): ONE client id/secret, one redirect
// URI per app. Feature-flagged: with GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / the redirect variable
// unset the button is hidden and the routes redirect — nothing crashes.
// Read at call time (module-scope reads get baked at build time when the env is unset).
// No "server-only" import here: this package also serves Astro. Never import it from client code —
// `googleConfig()` returns the client secret.

export const OAUTH_STATE_COOKIE = "g_oauth_state";

export type GoogleConfig = { clientId: string; clientSecret: string; redirectUri: string };

/** `redirectVar` names the env variable holding THIS app's callback; Google requires it to match a
 *  registered redirect URI exactly. Admin keeps the historical `GOOGLE_REDIRECT_URI`. */
export function googleConfig(redirectVar = "GOOGLE_REDIRECT_URI", env: Record<string, string | undefined> = process.env): GoogleConfig | null {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  const redirectUri = env[redirectVar];
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

export const googleEnabled = (redirectVar?: string): boolean => googleConfig(redirectVar) !== null;

/** `<prefix>.<128-bit hex nonce>` — the prefix (e.g. admin's login|daftar) rides in the HttpOnly
 *  state cookie and comes back in `state`. */
export const newOAuthState = (prefix: string): string => `${prefix}.${randomBytes(16).toString("hex")}`;

/** The callback's CSRF check: both present and identical. */
export const stateMatches = (state: string | null | undefined, cookieState: string | null | undefined): boolean =>
  !!state && !!cookieState && state === cookieState;

export function authorizeUrl(cfg: GoogleConfig, state: string): string {
  const p = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

export type GoogleProfile = { sub: string; email: string; name: string; emailVerified: boolean };

const googleJwks = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

/** Verify a Google id_token (issuer + audience against Google's JWKS). `keys` is injectable for tests. */
export async function verifyIdToken(idToken: string, clientId: string, keys: JWTVerifyGetKey = googleJwks): Promise<GoogleProfile | null> {
  try {
    const { payload } = await jwtVerify(idToken, keys, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: clientId,
    });
    const sub = String(payload.sub ?? "");
    const email = String(payload.email ?? "").toLowerCase();
    if (!sub || !email) return null;
    return {
      sub,
      email,
      name: String(payload.name ?? email.split("@")[0]),
      emailVerified: payload.email_verified === true,
    };
  } catch {
    return null;
  }
}

/** Exchange the authorization code for tokens, then verify the id_token against Google's JWKS. */
export async function exchangeCode(cfg: GoogleConfig, code: string, keys?: JWTVerifyGetKey): Promise<GoogleProfile | null> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { id_token?: string };
  if (!json.id_token) return null;
  return verifyIdToken(json.id_token, cfg.clientId, keys);
}
