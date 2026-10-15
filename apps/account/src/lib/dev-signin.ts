// LOCAL DEVELOPMENT ONLY: sign in by typing an email, no password, so the owner can try the account
// without a Google client (owner 2026-10-15: "local development dulu sampai final"). Same discipline
// as `devOtpSender`: refused in any production build, and it can only ever produce `dev:<email>`
// identities, a namespace a real Google `sub` (digits) can never collide with.
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i;

export function devSignInAllowed(env: Record<string, string | undefined> = process.env, prodBuild: boolean = import.meta.env?.PROD === true): boolean {
  return env.NODE_ENV !== "production" && !prodBuild;
}

/** `dev:<lower-case email>`, or null for anything that is not an email. */
export function devSubject(email: unknown): string | null {
  if (typeof email !== "string") return null;
  const e = email.trim().toLowerCase();
  return EMAIL.test(e) ? `dev:${e}` : null;
}
