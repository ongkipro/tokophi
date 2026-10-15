import { createHash, randomBytes } from "node:crypto";

// Seller-issued affiliate invitation (AFFILIATE_SPEC F-A15 / account spec ACC-14). The ONLY way an
// existing per-store affiliate row is bound to a TokoΦ Account — never an email or phone match.
// The token travels in the link the seller sends; only its sha256 is stored (`affiliates.invite_hash`),
// so a database read cannot replay it. Single use: accepting clears the hash.

export const INVITE_TTL_DAYS = 7;
const TOKEN = /^[A-Za-z0-9_-]{32}$/; // 24 random bytes, base64url

export function hashInvite(token: unknown): string | null {
  if (typeof token !== "string" || !TOKEN.test(token)) return null;
  return createHash("sha256").update(`affiliate-invite:${token}`).digest("hex");
}

export function newInvite(): { token: string; hash: string } {
  const token = randomBytes(24).toString("base64url");
  return { token, hash: hashInvite(token)! };
}
