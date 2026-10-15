import { createHmac, timingSafeEqual } from "node:crypto";

// Order claim token (buyer account, spec §17 D-3, Task 10.13). Stateless proof that whoever holds it
// saw THIS order's success response: `<b64url(orderId.issuedAtSec)>.<b64url(HMAC-SHA256)>`, keyed by
// ACCOUNT_CLAIM_SECRET under the "order-claim:" domain. It grants a CLAIM ATTEMPT on one order only;
// single-claimant is enforced later by `buyer_order_claims.order_id` unique (Task 10.5), not here.
// No secret configured → no token issued and none verifies: the feature is simply off.

export const CLAIM_TOKEN_TTL_SEC = 30 * 24 * 60 * 60; // 30 days — owner-delegated decision 2026-10-15 (spec §17 OD-4)
const CLOCK_SKEW_SEC = 60;
const MIN_SECRET_LEN = 32;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The configured secret, or null when unset/too short (read at call time). */
export function claimSecret(env: Record<string, string | undefined> = process.env): string | null {
  const s = env.ACCOUNT_CLAIM_SECRET;
  return s && s.length >= MIN_SECRET_LEN ? s : null;
}

const mac = (secret: string, payload: string) => createHmac("sha256", secret).update(`order-claim:${payload}`).digest();

export function issueClaimToken(orderId: string, secret: string, nowMs = Date.now()): string {
  if (secret.length < MIN_SECRET_LEN) throw new Error("issueClaimToken: secret too short");
  if (!UUID.test(orderId)) throw new Error("issueClaimToken: orderId must be a uuid");
  const payload = `${orderId.toLowerCase()}.${Math.floor(nowMs / 1000)}`;
  return `${Buffer.from(payload).toString("base64url")}.${mac(secret, payload).toString("base64url")}`;
}

/** The order id the token was issued for, or null (malformed, forged, expired, future-dated, or —
 *  when `expectOrderId` is given — issued for a different order). Constant-time on the MAC. */
export function verifyClaimToken(token: string, secret: string, nowMs = Date.now(), expectOrderId?: string): { orderId: string; issuedAt: number } | null {
  // A short/empty secret never verifies, whatever the caller passed (e.g. `env.X ?? ""`).
  if (typeof secret !== "string" || secret.length < MIN_SECRET_LEN) return null;
  const parts = typeof token === "string" ? token.split(".") : [];
  if (parts.length !== 2) return null;
  const payload = Buffer.from(parts[0], "base64url").toString("utf8");
  const supplied = Buffer.from(parts[1], "base64url");
  const expected = mac(secret, payload);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  // Re-encode check: base64url decoding is lenient, so only the canonical form is accepted.
  if (Buffer.from(payload).toString("base64url") !== parts[0] || expected.toString("base64url") !== parts[1]) return null;
  const m = /^([0-9a-f-]{36})\.(\d{1,12})$/.exec(payload);
  if (!m || !UUID.test(m[1])) return null;
  const issuedAt = Number(m[2]);
  const now = Math.floor(nowMs / 1000);
  if (issuedAt > now + CLOCK_SKEW_SEC || now - issuedAt > CLAIM_TOKEN_TTL_SEC) return null;
  if (expectOrderId !== undefined && m[1] !== expectOrderId.toLowerCase()) return null;
  return { orderId: m[1], issuedAt };
}
