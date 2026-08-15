import { describe, expect, it, afterEach } from "vitest";
import { authSecret } from "./secret";

describe("authSecret / resolveAuthSecret", () => {
  const origEnv = process.env.NODE_ENV;
  const origSecret = process.env.AUTH_SECRET;

  afterEach(() => {
    process.env.NODE_ENV = origEnv;
    process.env.AUTH_SECRET = origSecret;
  });

  it("returns AUTH_SECRET in production when secret is long and secure", () => {
    process.env.NODE_ENV = "production";
    process.env.AUTH_SECRET = "super-secret-random-key-with-high-entropy-32chars";
    expect(authSecret()).toBe("super-secret-random-key-with-high-entropy-32chars");
  });

  it("throws in production when AUTH_SECRET is unset or too short", () => {
    process.env.NODE_ENV = "production";
    delete process.env.AUTH_SECRET;
    expect(() => authSecret()).toThrow(/AUTH_SECRET is unset, too short, or uses a known insecure literal/);

    process.env.AUTH_SECRET = "short123";
    expect(() => authSecret()).toThrow(/AUTH_SECRET is unset, too short, or uses a known insecure literal/);
  });

  it("throws in production when AUTH_SECRET uses a known insecure fallback literal", () => {
    process.env.NODE_ENV = "production";
    process.env.AUTH_SECRET = "dev-insecure-change-me"; // 22 chars but insecure
    expect(() => authSecret()).toThrow(/AUTH_SECRET is unset, too short, or uses a known insecure literal/);

    process.env.AUTH_SECRET = "dev-insecure-secret-change-me";
    expect(() => authSecret()).toThrow(/AUTH_SECRET is unset, too short, or uses a known insecure literal/);
  });

  it("returns DEV_FALLBACK in development when AUTH_SECRET is unset", () => {
    process.env.NODE_ENV = "development";
    delete process.env.AUTH_SECRET;
    expect(authSecret()).toBe("dev-insecure-secret-change-me");
  });
});
