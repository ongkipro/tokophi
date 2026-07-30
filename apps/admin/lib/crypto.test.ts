import { beforeAll, describe, expect, it } from "vitest";

// ADR 0012 §27.1 requires coverage for token encryption/decryption. The two properties tested here are
// load-bearing security, and both fail SILENTLY if they regress: a weakened KDF is invisible until a
// DB dump leaks, and a missing AAD is invisible until a token is read under the wrong scope.
//
// `lib/crypto.ts` imports "server-only" (stubbed in vitest.config.ts) and reads its key from the env at
// call time, so the module is imported AFTER the key is set.
let crypto_: typeof import("./crypto");

beforeAll(async () => {
  process.env.INTEGRATION_TOKEN_KEY = "test-key-for-unit-tests-only-0123456789";
  crypto_ = await import("./crypto");
});

describe("token encryption", () => {
  it("round-trips a token under the same scope", () => {
    const { encryptSecret, decryptSecret, secretScope } = crypto_;
    const scope = secretScope("store-a", "meta");
    const blob = encryptSecret("EAAG-super-secret-token", scope);
    expect(blob).not.toContain("EAAG-super-secret-token");
    expect(blob.startsWith("v1:")).toBe(true);
    expect(decryptSecret(blob, scope)).toBe("EAAG-super-secret-token");
  });

  it("REFUSES a ciphertext moved to another store or channel (the AAD binding)", () => {
    const { encryptSecret, decryptSecret, secretScope } = crypto_;
    const blob = encryptSecret("token-of-store-a", secretScope("store-a", "meta"));
    // A restore, a "clone store" tool, or an upsert whose WHERE drifted could transplant this blob.
    // Without the binding it would decrypt cleanly and we would authenticate to Meta as store A.
    expect(decryptSecret(blob, secretScope("store-b", "meta"))).toBeNull();
    expect(decryptSecret(blob, secretScope("store-a", "tiktok"))).toBeNull();
  });

  it("returns null rather than throwing on tampered, truncated or foreign input", () => {
    const { encryptSecret, decryptSecret, secretScope } = crypto_;
    const scope = secretScope("store-a", "meta");
    const blob = encryptSecret("abc", scope);
    const parts = blob.split(":");
    // Flip a byte of the ciphertext — GCM must reject it, and the caller must see "absent", not a crash
    // inside a cron tick that is mid-way through a batch of conversions.
    const tampered = [parts[0], parts[1], parts[2], Buffer.from("nonsense").toString("base64")].join(":");
    expect(decryptSecret(tampered, scope)).toBeNull();
    expect(decryptSecret("not-a-blob", scope)).toBeNull();
    expect(decryptSecret("v2:a:b:c", scope)).toBeNull();
    expect(decryptSecret(null, scope)).toBeNull();
  });

  it("uses a fresh nonce — the same token encrypted twice is not the same ciphertext", () => {
    const { encryptSecret, secretScope } = crypto_;
    const scope = secretScope("store-a", "meta");
    expect(encryptSecret("same", scope)).not.toBe(encryptSecret("same", scope));
  });

  it("scopes are distinct per (store, channel)", () => {
    const { secretScope } = crypto_;
    expect(secretScope("a", "meta")).not.toBe(secretScope("a", "google"));
    expect(secretScope("a", "meta")).not.toBe(secretScope("b", "meta"));
  });
});
