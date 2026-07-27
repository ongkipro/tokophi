import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// AES-256-GCM secret-at-rest for integration tokens (Meta CAPI / GA4 MP / TikTok Events API) — ADR 0012
// §0.6. There is no other at-rest cipher in the repo (only scrypt for passwords + jose for sessions), so
// this is it. Server-only: the key never reaches a client bundle, exactly like lib/auth.ts's secret.
//
// Ciphertext format is VERSIONED so the key can rotate without a data migration:
//   v1:<iv_b64>:<tag_b64>:<ciphertext_b64>
// The 32-byte AES key is derived as sha256(INTEGRATION_TOKEN_KEY), so the env var may be any non-trivial
// string (a 64-hex/base64 secret is ideal). Rotating = introduce v2 with a new key, decrypt-v1/re-encrypt.
const KEY_ENV = "INTEGRATION_TOKEN_KEY";

function keyBytes(): Buffer {
  const raw = process.env[KEY_ENV];
  if (!raw || raw.length < 16) {
    // Fail closed in production; in dev, a missing key means "no encryption configured" and the caller
    // (setTrackingChannel) should refuse to store a token rather than persist plaintext.
    throw new Error(`${KEY_ENV} is not set (min 16 chars) — cannot encrypt integration secrets.`);
  }
  return createHash("sha256").update(raw).digest(); // 32 bytes
}

/** True when the encryption key is configured — lets callers gate the CAPI-token field cleanly. */
export function encryptionAvailable(): boolean {
  const raw = process.env[KEY_ENV];
  return !!raw && raw.length >= 16;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12); // 96-bit nonce, the GCM standard
  const cipher = createCipheriv("aes-256-gcm", keyBytes(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

/** Returns null on any tamper/format/key error — a secret we can't decrypt is treated as absent, never thrown into a request path. */
export function decryptSecret(blob: string | null | undefined): string | null {
  if (!blob) return null;
  const parts = blob.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  try {
    const [, ivB64, tagB64, ctB64] = parts;
    const decipher = createDecipheriv("aes-256-gcm", keyBytes(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
