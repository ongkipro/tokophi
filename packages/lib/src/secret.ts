// The HS256 signing key behind every session JWT, impersonation token, recovery link and abuse hash.
// In production a missing or weak AUTH_SECRET must be IMPOSSIBLE: silently falling back to a public dev
// string would make every one of those forgeable — anyone could mint a valid session or impersonation
// token. So we FAIL CLOSED: throw in production. Only in development do we return the well-known dev key
// (dev data is disposable, and a local session must not be logged out just because the env is absent).
//
// Two deliberate design points:
//  1. The throw is LAZY — it fires when the key is first USED at runtime, never at module load. `next
//     build` / `astro build` run with NODE_ENV=production but WITHOUT the runtime AUTH_SECRET (it is a
//     runtime `environment:` var, not a build arg), so a module-load throw would break every build.
//  2. This module imports NOTHING (only reads `process.env`), so it is safe to import into edge
//     middleware, where the session cookie is verified.
//
// This module is dependency-free on purpose — keep it that way.

const DEV_FALLBACK = "dev-insecure-secret-change-me"; // the exact string the call sites used before

const INSECURE_LITERALS = [
  "dev-insecure-secret-change-me",
  "dev-insecure-change-me",
  "dev-insecure-secret",
  "dev-insecure-key",
];

function resolveAuthSecret(): string {
  const s = process.env.AUTH_SECRET;
  const isInsecure = !s || s.length < 16 || INSECURE_LITERALS.some((l) => s.includes(l));
  if (!isInsecure) return s!;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "[auth] AUTH_SECRET is unset, too short, or uses a known insecure literal in production — refusing to sign or verify tokens with an insecure key. Set a strong AUTH_SECRET (32+ random chars) in the environment.",
    );
  }
  return DEV_FALLBACK;
}

let cachedBytes: Uint8Array | undefined;

/** AUTH_SECRET as bytes for jose (HS256). Memoised. Throws in production if the secret is missing/weak. */
export function authSecretBytes(): Uint8Array {
  return (cachedBytes ??= new TextEncoder().encode(resolveAuthSecret()));
}

/** The raw AUTH_SECRET string (e.g. to salt an abuse hash). Throws in production if missing/weak. */
export function authSecret(): string {
  return resolveAuthSecret();
}
