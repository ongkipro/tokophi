import { describe, expect, it } from "vitest";
import { hashInvite, newInvite } from "./account-invite";

describe("account-invite", () => {
  it("mints a 32-char token whose hash is reproducible and not the token", () => {
    const { token, hash } = newInvite();
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(hashInvite(token)).toBe(hash);
    expect(hash).not.toContain(token);
  });
  it("two invites never collide", () => {
    expect(newInvite().token).not.toBe(newInvite().token);
  });
  it("refuses malformed input instead of hashing it", () => {
    for (const bad of [undefined, null, "", "short", "a".repeat(33), "a".repeat(31) + "=", 42]) expect(hashInvite(bad)).toBeNull();
  });
});
