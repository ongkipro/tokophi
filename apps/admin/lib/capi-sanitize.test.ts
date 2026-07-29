import { describe, expect, it } from "vitest";
import { classify, sanitize } from "./capi-sanitize";

// `sanitize()` is what stands between a provider's error body and `last_error_message` — a column the
// merchant reads on screen and pastes into support tickets. Meta and TikTok both echo the request back
// on a rejection, and the request carries the access token. One test, because the failure mode is
// silent: nothing throws when a token leaks into the UI.
describe("sanitize", () => {
  it("redacts an access_token echoed back by the provider", () => {
    const body = '{"error":{"message":"Invalid parameter","access_token":"EAAG9ZChd0ZBsBO1234567890abcdefghijklmnop"}}';
    const out = sanitize(body);
    expect(out).not.toContain("EAAG9ZChd0ZBsBO1234567890abcdefghijklmnop");
    expect(out).toContain("[redacted]");
  });

  it("redacts a GA4 api_secret and a TikTok Access-Token header echo", () => {
    expect(sanitize("api_secret=Xy7_kLmNoPqRsTuVwXyZ01")).not.toContain("Xy7_kLmNoPqRsTuVwXyZ01");
    expect(sanitize('Access-Token: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEF"')).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789ABCDEF");
  });

  it("keeps the diagnostic part of the message — a redacted string must still be readable", () => {
    expect(sanitize('{"error":{"message":"Invalid parameter"}}')).toContain("Invalid parameter");
  });

  it("bounds the length so one provider essay cannot fill the column", () => {
    expect(sanitize("x".repeat(5000)).length).toBeLessThanOrEqual(400);
  });

  it("survives a non-string body instead of throwing into the cron", () => {
    expect(() => sanitize({ nested: { code: 1 } })).not.toThrow();
    expect(() => sanitize(undefined)).not.toThrow();
  });
});

// The retry verdict decides whether a conversion is retried or dead-lettered. Backwards either way
// costs the merchant: a permanent verdict on a transient error loses the sale, the reverse hammers a
// provider forever.
describe("classify", () => {
  it("accepts any 2xx, including GA4's 204-for-everything", () => {
    expect(classify(200, "")).toMatchObject({ ok: true, retryable: false });
    expect(classify(204, "")).toMatchObject({ ok: true, retryable: false });
  });

  it("retries throttling and provider outages", () => {
    expect(classify(429, "slow down")).toMatchObject({ ok: false, retryable: true });
    expect(classify(503, "unavailable")).toMatchObject({ ok: false, retryable: true });
  });

  it("does NOT retry auth failures — they will be just as wrong next time", () => {
    // TikTok's real answers to a missing / bad token, probed 2026-07-29.
    expect(classify(400, '{"code":40104,"message":"The access_token is empty."}')).toMatchObject({ ok: false, retryable: false });
    expect(classify(401, '{"code":40105}')).toMatchObject({ ok: false, retryable: false });
  });

  it("carries the SANITIZED body into the error message, never the raw one", () => {
    const r = classify(400, '{"error":{"access_token":"EAAG1234567890abcdefghijklmnopqrstuvwxyz"}}');
    expect(r.errorMessage).not.toContain("EAAG1234567890abcdefghijklmnopqrstuvwxyz");
  });
});
