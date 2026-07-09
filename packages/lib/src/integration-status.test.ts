import { describe, it, expect } from "vitest";
import { AUTOLARIS_RC_OK, channelActiveFromRc, isConfigured } from "./integration-status";

// "ada test untuk active tidaknya" — the rules the super-admin Pengaturan uses to decide whether a
// payment channel / integration is ACTIVE. These are the pure decisions behind the "Aktif" badges
// and the "Test koneksi" buttons; the network calls just feed them rc codes / keys.

describe("channelActiveFromRc (AutoLaris channel active?)", () => {
  it("rc=00 → active", () => {
    expect(channelActiveFromRc(AUTOLARIS_RC_OK)).toBe(true);
    expect(channelActiveFromRc("00")).toBe(true);
  });

  it("any non-00 rc → not active", () => {
    expect(channelActiveFromRc("07")).toBe(false); // channel not enabled on the account
    expect(channelActiveFromRc("99")).toBe(false);
    expect(channelActiveFromRc("")).toBe(false);
  });

  it("missing/nullish rc → not active (never crashes)", () => {
    expect(channelActiveFromRc(null)).toBe(false);
    expect(channelActiveFromRc(undefined)).toBe(false);
  });
});

describe("isConfigured (integration credential present?)", () => {
  it("non-empty key → configured", () => {
    expect(isConfigured("secret-key")).toBe(true);
  });

  it("empty / whitespace / missing key → not configured", () => {
    expect(isConfigured("")).toBe(false);
    expect(isConfigured("   ")).toBe(false);
    expect(isConfigured(null)).toBe(false);
    expect(isConfigured(undefined)).toBe(false);
  });
});
