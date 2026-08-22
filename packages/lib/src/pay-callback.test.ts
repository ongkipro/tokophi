import { afterEach, describe, expect, it, vi } from "vitest";
import { alInquirePaymentStatus } from "./autolaris";
import {
  PAY_CALLBACK_PARAM,
  payCallbackAmountMatches,
  payCallbackUrl,
  signPayCallbackRef,
  verifyPayCallbackRef,
  verifyPayCallbackSecret,
} from "./pay-callback";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/**
 * SEC-16: the callback URL we hand AutoLaris carries a per-payment signature, never the reusable
 * `AUTOLARIS_CALLBACK_SECRET`. The secret is what marks ANY payment on the platform paid; a signature
 * is worth exactly one reference. These are the claims that keep the old shape from coming back.
 */
describe("payCallbackUrl", () => {
  const SECRET = "the-platform-callback-secret";

  it("never puts the reusable secret in the URL, and signs the reference instead", () => {
    vi.stubEnv("PUBLIC_APP_URL", "https://app.tokophi.test");
    vi.stubEnv("AUTOLARIS_CALLBACK_SECRET", SECRET);

    const url = payCallbackUrl("INV-4711");

    expect(url).not.toContain(SECRET);
    expect(url).not.toContain(encodeURIComponent(SECRET));
    expect(url).not.toMatch(/[?&]token=/);

    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://app.tokophi.test/api/public/pay/callback");
    // ONE parameter, like the `?token=` it replaces — the shape the gateway is known to echo back.
    expect([...parsed.searchParams.keys()]).toEqual([PAY_CALLBACK_PARAM]);
    expect(verifyPayCallbackRef(parsed.searchParams.get(PAY_CALLBACK_PARAM), SECRET)).toBe("INV-4711");
  });

  it("stays bare with no secret configured — local dev, where the endpoint accepts an unauthenticated callback", () => {
    vi.stubEnv("PUBLIC_APP_URL", "https://app.tokophi.test");
    vi.stubEnv("AUTOLARIS_CALLBACK_SECRET", "");
    expect(payCallbackUrl("INV-4711")).toBe("https://app.tokophi.test/api/public/pay/callback");
  });
});

describe("verifyPayCallbackRef", () => {
  const SECRET = "the-platform-callback-secret";
  const signed = (ref: string) => `${ref}.${signPayCallbackRef(ref, SECRET)}`;

  it("returns the reference it authorises, never a bare boolean", () => {
    expect(verifyPayCallbackRef(signed("SUB-batik-991"), SECRET)).toBe("SUB-batik-991");
    // A reference may contain dots (`requestKey` allows them); the signature never does.
    expect(verifyPayCallbackRef(signed("ORD.2026.11"), SECRET)).toBe("ORD.2026.11");
  });

  it("refuses a tampered reference, a tampered signature, a foreign secret and malformed input", () => {
    const good = signed("INV-4711");
    // Same signature, different reference — the exact replay the binding exists to stop.
    expect(verifyPayCallbackRef(`INV-4712.${good.split(".")[1]}`, SECRET)).toBeNull();
    expect(verifyPayCallbackRef(`INV-4711.${"0".repeat(32)}`, SECRET)).toBeNull();
    expect(verifyPayCallbackRef(good, "some-other-secret")).toBeNull();
    expect(verifyPayCallbackRef(good.slice(0, -1), SECRET)).toBeNull();
    expect(verifyPayCallbackRef("INV-4711", SECRET)).toBeNull();
    expect(verifyPayCallbackRef(".abc", SECRET)).toBeNull();
    expect(verifyPayCallbackRef("INV-4711.", SECRET)).toBeNull();
    expect(verifyPayCallbackRef(null, SECRET)).toBeNull();
    expect(verifyPayCallbackRef(good, undefined)).toBeNull();
    // The secret itself is not a passport: pasting it where the signature goes proves nothing.
    expect(verifyPayCallbackRef(`INV-4711.${SECRET}`, SECRET)).toBeNull();
  });
});

describe("verifyPayCallbackSecret", () => {
  it("accepts only the exact configured callback secret", () => {
    expect(verifyPayCallbackSecret("gateway-secret", "gateway-secret")).toBe(true);
    expect(verifyPayCallbackSecret("gateway-secrex", "gateway-secret")).toBe(false);
    expect(verifyPayCallbackSecret("short", "gateway-secret")).toBe(false);
    expect(verifyPayCallbackSecret(null, "gateway-secret")).toBe(false);
  });

  it("fails closed when configuration is absent unless local development opts in", () => {
    expect(verifyPayCallbackSecret(null, undefined)).toBe(false);
    expect(verifyPayCallbackSecret("anything", undefined)).toBe(false);
    expect(verifyPayCallbackSecret(null, undefined, true)).toBe(true);
  });
});

describe("payCallbackAmountMatches", () => {
  it("accepts an exact safe-integer IDR amount from JSON numbers or digit strings", () => {
    expect(payCallbackAmountMatches(125_000, 125_000)).toBe(true);
    expect(payCallbackAmountMatches("125000", 125_000)).toBe(true);
    expect(payCallbackAmountMatches("00125000", 125_000)).toBe(true);
  });

  it("rejects missing, mismatched, fractional and coercible-looking amounts", () => {
    expect(payCallbackAmountMatches(undefined, 125_000)).toBe(false);
    expect(payCallbackAmountMatches(124_999, 125_000)).toBe(false);
    expect(payCallbackAmountMatches(125_000.5, 125_000)).toBe(false);
    expect(payCallbackAmountMatches("125000.00", 125_000)).toBe(false);
    expect(payCallbackAmountMatches("1.25e5", 125_000)).toBe(false);
    expect(payCallbackAmountMatches(" 125000 ", 125_000)).toBe(false);
  });

  it("rejects unsafe or negative stored amounts", () => {
    expect(payCallbackAmountMatches(Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER + 1)).toBe(false);
    expect(payCallbackAmountMatches(-1, -1)).toBe(false);
  });
});

describe("alInquirePaymentStatus", () => {
  it("normalizes a successful gateway status inquiry", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      rc: "00",
      ket: "Sukses",
      data: {
        trx_id: "TRX-42",
        reff_id: "PHI-42",
        status: "paid",
        amount: 125_000,
        total: 128_000,
        paid_at: "2026-08-15 12:00:00",
      },
    })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(alInquirePaymentStatus("  TRX-42  ")).resolves.toEqual({
      ok: true,
      trxId: "TRX-42",
      reffId: "PHI-42",
      status: "PAID",
      amount: 125_000,
      total: 128_000,
      paidAt: "2026-08-15 12:00:00",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api-h2h.autolaris.com/api/h2h/inquiry_payment",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ trx_id: "TRX-42" }),
      }),
    );
  });

  it("fails closed on invalid input and non-success gateway responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ rc: "404", ket: "Tidak ditemukan" })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(alInquirePaymentStatus("   ")).resolves.toEqual({ ok: false, error: "trx_id wajib diisi." });
    expect(fetchMock).not.toHaveBeenCalled();

    await expect(alInquirePaymentStatus("TRX-missing")).resolves.toEqual({
      ok: false,
      error: "Tidak ditemukan",
    });
  });
});
