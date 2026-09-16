import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

// AES-256-GCM secret-at-rest for integration tokens (Meta CAPI / GA4 MP / TikTok Events API) — ADR 0012
// §0.6 — and, since Task 8.33, for the platform's own provider keys (KiriminAja / AutoLaris, written
// by Super Admin into `shipping_aggregator.*_key_enc` / `platform_payment_gateways.credentials_enc`).
// There is no other at-rest cipher in the repo (only scrypt for passwords + jose for sessions), so
// this is it. Server-only: the key never reaches a client bundle, exactly like lib/auth.ts's secret.
//
// It moved here from `apps/admin/lib/crypto.ts` (which re-exports it unchanged) because the DB
// loader in `packages/db` and the Super Admin actions both need the SAME cipher — a second copy is
// how the weaker half survives a fix (see `platform-rank.ts`, `password.ts`).
// ⚠️ No `import "server-only"` HERE, deliberately: `server-only` is not an npm dependency of this
// repo (Next aliases it, vitest stubs it), so a module carrying it cannot be loaded by `tsx` — and
// `packages/db` (seed, verify-*, the loader below) is. The admin re-export keeps the guard for the
// app; nothing under `apps/*/components` may import this path, and `node:crypto` would fail to
// bundle for the browser anyway.
//
// Ciphertext format is VERSIONED so the key can rotate without a data migration:
//   v1:<iv_b64>:<tag_b64>:<ciphertext_b64>
// Rotating = introduce v2 with a new key, decrypt-v1/re-encrypt.
//
// TWO THINGS HERE ARE LOAD-BEARING, both from the 2026-07-29 security review:
//
//  1. **The key is derived with scrypt, not a bare SHA-256.** The env var is allowed to be a
//     memorable string, so a single unsalted hash round would let anyone holding a DB dump brute-force
//     it offline at GPU speed. scrypt (the same primitive `lib/auth.ts` already uses for passwords)
//     makes that expensive. It is computed ONCE and cached — scrypt is deliberately slow, and the cron
//     decrypts on every delivery.
//  2. **Every ciphertext is bound to the row it belongs to** via GCM's additional authenticated data
//     (`store:channel`). Without it the blob is free-floating: any future code path that writes a
//     token it did not read back — a restore, a "clone store" tool, an upsert whose WHERE drifts —
//     could transplant store A's token into store B's row and we would happily authenticate to a
//     provider as store A. With the AAD, a transplanted blob simply fails to decrypt and the caller
//     treats it as absent. This is the CHILD-TABLE class of bug wearing a different hat.
const KEY_ENV = "INTEGRATION_TOKEN_KEY";
// Fixed salt: the value being stretched is a single server-wide secret, not a per-user password, so
// there is nothing to prevent a rainbow table over — the salt only domain-separates this key from any
// other scrypt use in the codebase.
const KDF_SALT = "tokophi:integration-token:v1";

let cachedKey: { raw: string; key: Buffer } | null = null;

function keyBytes(): Buffer {
  const raw = process.env[KEY_ENV];
  if (!raw || raw.length < 16) {
    // Fail closed in production; in dev, a missing key means "no encryption configured" and the caller
    // (setTrackingChannel) should refuse to store a token rather than persist plaintext.
    throw new Error(`${KEY_ENV} is not set (min 16 chars) — cannot encrypt integration secrets.`);
  }
  if (cachedKey && cachedKey.raw === raw) return cachedKey.key;
  const key = scryptSync(raw, KDF_SALT, 32);
  cachedKey = { raw, key };
  return key;
}

/** True when the encryption key is configured — lets callers gate the CAPI-token field cleanly. */
export function encryptionAvailable(): boolean {
  const raw = process.env[KEY_ENV];
  return !!raw && raw.length >= 16;
}

/**
 * `scope` binds the ciphertext to its row — pass the SAME value on the way back out. For tracking
 * tokens that is `secretScope(storeId, channel)`; a blob decrypted under any other scope is rejected.
 */
export function encryptSecret(plaintext: string, scope: string): string {
  const iv = randomBytes(12); // 96-bit nonce, the GCM standard
  const cipher = createCipheriv("aes-256-gcm", keyBytes(), iv);
  cipher.setAAD(Buffer.from(scope, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

/** Returns null on any tamper/format/key/scope error — a secret we can't decrypt is treated as absent, never thrown into a request path. */
export function decryptSecret(blob: string | null | undefined, scope: string): string | null {
  if (!blob) return null;
  const parts = blob.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  try {
    const [, ivB64, tagB64, ctB64] = parts;
    const decipher = createDecipheriv("aes-256-gcm", keyBytes(), Buffer.from(ivB64, "base64"));
    decipher.setAAD(Buffer.from(scope, "utf8"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** The one definition of a tracking token's scope — both sides MUST build it the same way. */
export const secretScope = (storeId: string, channel: string) => `tracking:${storeId}:${channel}`;
