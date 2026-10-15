import { createHmac, timingSafeEqual } from "node:crypto";

// Affiliate dashboard link (F-A18, Task 9.13). Interim self-view until affiliates sign in with the
// buyer account (F-A15): the seller copies a signed link and sends it to the affiliate.
// `<b64url(affiliateId.storeId.issuedAtSec)>.<b64url(HMAC-SHA256)>`, keyed by AFFILIATE_LINK_SECRET
// under the "affiliate-view:" domain. Stateless: deactivating the affiliate kills every link (the
// page checks `aktif`); rotating the secret kills them all. Secret under 32 chars = feature off.

export const AFFILIATE_LINK_TTL_SEC = 90 * 24 * 60 * 60; // 90 days
const CLOCK_SKEW_SEC = 60;
const MIN_SECRET_LEN = 32;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The configured secret, or null when unset/too short (read at call time). */
export function affiliateLinkSecret(env: Record<string, string | undefined> = process.env): string | null {
  const s = env.AFFILIATE_LINK_SECRET;
  return s && s.length >= MIN_SECRET_LEN ? s : null;
}

const mac = (secret: string, payload: string) => createHmac("sha256", secret).update(`affiliate-view:${payload}`).digest();

export function issueAffiliateLink(affiliateId: string, storeId: string, secret: string, nowMs = Date.now()): string {
  if (typeof secret !== "string" || secret.length < MIN_SECRET_LEN) throw new Error("issueAffiliateLink: secret too short");
  if (!UUID.test(affiliateId) || !UUID.test(storeId)) throw new Error("issueAffiliateLink: ids must be uuids");
  const payload = `${affiliateId.toLowerCase()}.${storeId.toLowerCase()}.${Math.floor(nowMs / 1000)}`;
  return `${Buffer.from(payload).toString("base64url")}.${mac(secret, payload).toString("base64url")}`;
}

/** `{affiliateId, storeId}` the link was issued for, or null (malformed, forged, expired, future-dated,
 *  short secret, or — when `expectStoreId` is given — issued for another store). Constant-time on the MAC. */
export function verifyAffiliateLink(
  token: string,
  secret: string,
  nowMs = Date.now(),
  expectStoreId?: string,
): { affiliateId: string; storeId: string; issuedAt: number } | null {
  if (typeof secret !== "string" || secret.length < MIN_SECRET_LEN) return null;
  const parts = typeof token === "string" ? token.split(".") : [];
  if (parts.length !== 2) return null;
  const payload = Buffer.from(parts[0], "base64url").toString("utf8");
  const supplied = Buffer.from(parts[1], "base64url");
  const expected = mac(secret, payload);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  // base64url decoding is lenient, so only the canonical form is accepted.
  if (Buffer.from(payload).toString("base64url") !== parts[0] || expected.toString("base64url") !== parts[1]) return null;
  const m = /^([0-9a-f-]{36})\.([0-9a-f-]{36})\.(\d{1,12})$/.exec(payload);
  if (!m || !UUID.test(m[1]) || !UUID.test(m[2])) return null;
  const issuedAt = Number(m[3]);
  const now = Math.floor(nowMs / 1000);
  if (issuedAt > now + CLOCK_SKEW_SEC || now - issuedAt > AFFILIATE_LINK_TTL_SEC) return null;
  if (expectStoreId !== undefined && m[2] !== expectStoreId.toLowerCase()) return null;
  return { affiliateId: m[1], storeId: m[2], issuedAt };
}
