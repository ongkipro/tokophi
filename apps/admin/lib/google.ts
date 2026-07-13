import "server-only";
import { createRemoteJWKSet, jwtVerify } from "jose";

// Google Sign-In (OAuth 2.0 authorization-code flow, plain fetch — no extra deps).
// Feature-flagged: with GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI unset the
// button is hidden and the routes 404-ish (redirect to /login) — nothing crashes.
// Read at call time (module-scope reads get baked at build time when the env is unset).

export const OAUTH_STATE_COOKIE = "g_oauth_state";

export type GoogleConfig = { clientId: string; clientSecret: string; redirectUri: string };

export function googleConfig(): GoogleConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

export const googleEnabled = (): boolean => googleConfig() !== null;

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

const jwks = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

/** Exchange the authorization code for tokens, then verify the id_token against Google's JWKS. */
export async function exchangeCode(cfg: GoogleConfig, code: string): Promise<GoogleProfile | null> {
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

  try {
    const { payload } = await jwtVerify(json.id_token, jwks, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: cfg.clientId,
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
