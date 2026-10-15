import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MS,
  checkOtp,
  devOtpSender,
  generateOtp,
  hashOtp,
  resendAfterMs,
  type OtpChallenge,
} from "./buyer-otp";

const SECRET = "test-secret";
const PHONE = "6281234567890";
const NOW = 1_700_000_000_000;

const challenge = (code: string, over: Partial<OtpChallenge> = {}): OtpChallenge => ({
  phone: PHONE,
  codeHash: hashOtp(PHONE, code, SECRET),
  expiresAt: NOW + OTP_TTL_MS,
  attempts: 0,
  consumedAt: null,
  ...over,
});

describe("buyer OTP", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("generates six digits, zero-padded", () => {
    for (let i = 0; i < 200; i++) expect(generateOtp()).toMatch(/^\d{6}$/);
  });

  it("binds the hash to phone and secret", () => {
    const h = hashOtp(PHONE, "123456", SECRET);
    expect(hashOtp("6289999999999", "123456", SECRET)).not.toBe(h);
    expect(hashOtp(PHONE, "123456", "other")).not.toBe(h);
    expect(h).not.toContain("123456");
  });

  it("accepts the right code, tolerating spaces", () => {
    expect(checkOtp(challenge("123456"), "123 456", SECRET, NOW)).toBe("ok");
  });

  it("refuses wrong, malformed, expired, consumed and locked", () => {
    expect(checkOtp(challenge("123456"), "654321", SECRET, NOW)).toBe("wrong");
    expect(checkOtp(challenge("123456"), "12345", SECRET, NOW)).toBe("malformed");
    expect(checkOtp(challenge("123456"), "12345a", SECRET, NOW)).toBe("malformed");
    expect(checkOtp(challenge("123456"), "123456", SECRET, NOW + OTP_TTL_MS)).toBe("expired");
    expect(checkOtp(challenge("123456", { consumedAt: NOW }), "123456", SECRET, NOW)).toBe("consumed");
    expect(checkOtp(challenge("123456", { attempts: OTP_MAX_ATTEMPTS }), "123456", SECRET, NOW)).toBe("locked");
  });

  it("a correct code cannot revive a dead challenge (consumed beats expired beats locked)", () => {
    const dead = challenge("123456", { consumedAt: NOW, expiresAt: NOW - 1, attempts: OTP_MAX_ATTEMPTS });
    expect(checkOtp(dead, "123456", SECRET, NOW)).toBe("consumed");
    expect(checkOtp({ ...dead, consumedAt: null }, "123456", SECRET, NOW)).toBe("expired");
  });

  it("enforces the 60 s resend cooldown", () => {
    expect(resendAfterMs(null, NOW)).toBe(0);
    expect(resendAfterMs(NOW, NOW + 10_000)).toBe(50_000);
    expect(resendAfterMs(NOW, NOW + 61_000)).toBe(0);
  });

  it("dev sender logs locally and refuses production", async () => {
    const lines: string[] = [];
    await devOtpSender((l) => lines.push(l)).send(PHONE, "123456");
    expect(lines).toEqual([`[dev-otp] ${PHONE} → 123456`]);
    vi.stubEnv("NODE_ENV", "production");
    expect(() => devOtpSender()).toThrow(/not allowed in production/);
  });
});
