import { afterEach, describe, expect, it, vi } from "vitest";
import { alInquirePaymentStatus } from "./autolaris";
import { payCallbackAmountMatches, verifyPayCallbackSecret } from "./pay-callback";

afterEach(() => {
  vi.unstubAllGlobals();
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
