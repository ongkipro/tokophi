import { describe, expect, it } from "vitest";
import { refused } from "./refused";

// N48: the six call sites that toasted success over a refusal now route every action result through
// `refused`. What it must never do is return `null` for a real refusal — that is the original bug.
describe("refused", () => {
  it("passes a success through untouched", () => {
    expect(refused({ ok: true })).toBeNull();
    expect(refused({ ok: true, password: "x" })).toBeNull();
  });

  it("reads the refusal wherever the action put the string", () => {
    // the 24 actions gated by `platformGate` return `error`…
    expect(refused({ ok: false, error: "Tidak diizinkan — perlu peran owner, akun ini support." }))
      .toBe("Tidak diizinkan — perlu peran owner, akun ini support.");
    // …the three connectivity/sync ones report through `message` instead.
    expect(refused({ ok: false, message: "Auth ditolak / respons tidak valid." }))
      .toBe("Auth ditolak / respons tidak valid.");
  });

  it("never hands the toast an empty string", () => {
    // A wordless refusal would render as an empty red toast — silent, exactly like the bug.
    expect(refused({ ok: false })).toBeTruthy();
    expect(refused({ ok: false, error: "   " })).toBeTruthy();
  });

  it("treats a void action as a success", () => {
    // `signOut` and friends still return nothing; a caller must not be told they failed.
    expect(refused(undefined)).toBeNull();
    expect(refused(null)).toBeNull();
  });
});
