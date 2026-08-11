import { describe, expect, it } from "vitest";
import { isNamelessHost } from "./host-fallback";



describe("isNamelessHost", () => {
  // 🔴 THE REGRESSION. A merchant's custom domain must NEVER be answered with the default store.
  // This is the exact host that served Batik Nusantara's catalogue on 2026-08-11.
  it.each(["beautyinu.co", "www.beautyinu.co", "taniniaga.com", "some-random-domain.example"])(
    "refuses %j — a real domain must 404, never fall back",
    (h) => expect(isNamelessHost(h)).toBe(false),
  );

  // A store subdomain IS platform-owned, so this returns true — and that is safe, because the fallback
  // is unreachable for it: `slugFromBaseDomain` yields a candidate ("beautyinyu"), and `getStoreByHost`
  // returns 404 on an unmatched candidate BEFORE reaching this predicate. The guarantee that matters is
  // the one below: a host outside our zones can never be answered with the default store.
  it("treats a store subdomain as platform-owned (the candidate guard fires first)", () =>
    expect(isNamelessHost("beautyinyu.tokophi.id")).toBe(true));

  it.each(["localhost", "app.localhost", "127.0.0.1", "10.0.2.9", "::1"])(
    "allows %j — local development",
    (h) => expect(isNamelessHost(h)).toBe(true),
  );

  it("allows the sslip.io dev convenience", () =>
    expect(isNamelessHost("toko.45.77.33.112.sslip.io")).toBe(true));

  // Anything inside a platform zone is ours and can never be a merchant's domain. `toko.tokophi.com`
  // is the demo shop and has ALWAYS been served through this fallback — 404ing it was the regression
  // this rewrite exists to prevent, caught by testing production before deploying.
  it.each(["tokophi.id", "www.tokophi.id", "toko.tokophi.com", "tokophi.com", "cname.tokophi.cc"])(
    "allows platform-owned %j",
    (h) => expect(isNamelessHost(h)).toBe(true),
  );

  it("allows an empty host", () => expect(isNamelessHost("")).toBe(true));

  // A lookalike must not slip through on a suffix match.
  it.each(["nottokophi.id", "tokophi.id.evil.com", "faketokophi.com"])("refuses lookalike %j", (h) =>
    expect(isNamelessHost(h)).toBe(false));
});
