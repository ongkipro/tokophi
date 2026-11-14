import { createHash, randomBytes } from "node:crypto";

// Seller-issued affiliate invitation (ADR 0022, AFFILIATE_SPEC F-A15). The ONLY way an existing
// per-store affiliate row is bound to an affiliate account — never an email or phone match.
// The token travels in the link the seller sends; only its sha256 is stored (`affiliates.invite_hash`),
// so a database read cannot replay it. Single use: the one UPDATE that binds the row clears the hash.
// Kept apart from `affiliate.ts` because that module is imported by client components (no node:crypto).

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
