import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MengantarPartnerConfigError,
  mengantarExternalUserId,
  partnerGetSellerKey,
  partnerListSellers,
  partnerPhone,
  partnerRegenerateSellerKey,
  partnerRegisterSeller,
  partnerSellerName,
  signPartnerRequest,
  type PartnerCallOptions,
} from "./mengantar-partner";
import type { MengantarPartnerConfig } from "./provider-config";

// The Partner client against a MOCKED transport only — nothing here reaches the network.

const SECRET = "partner-secret-fixture-0001";
const cfg: MengantarPartnerConfig = {
  env: "sandbox",
  envSource: "default",
  partnerBase: "https://partner.test",
  publicBase: "https://public.test",
  partnerId: "tokophi-fixture",
  partnerSecret: SECRET,
  source: "env",
};

type Call = { url: string; init: RequestInit };
function mockFetch(...responses: Array<Response | Error>) {
  const calls: Call[] = [];
  let i = 0;
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const r = responses[Math.min(i++, responses.length - 1)];
    if (r instanceof Error) throw r;
    return r.clone();
  });
  const opts: PartnerCallOptions = { cfg, fetch: fn as unknown as typeof fetch, now: () => 1_758_790_800_000 };
  return { opts, calls, fn };
}
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const H = (c: Call) => c.init.headers as Record<string, string>;

const REG = { name: "Toko Uji", email: "Owner@Example.test", phone: "0812-3456-7890", externalUserId: "tokophi:sandbox:store:abc" };

describe("signing", () => {
  it("matches the offline vector (synthetic values)", () => {
    expect(
      signPartnerRequest({ method: "POST", path: "/api/partner/v1/sellers/api-key", body: '{"sellerId":"fixture-seller"}', timestamp: "1758790800", secret: "offline-fixture-only" }),
    ).toBe("6ad3b743496bb5ed0c03b7696d8b4f8504ec04ef29b48f33637195c7ba794a5a");
  });

  it("signs the EXACT bytes it sends, with a seconds timestamp, and never sends the secret", async () => {
    const m = mockFetch(json(200, { success: true, data: { sellers: [], total: 0 } }));
    await partnerListSellers({ externalUserId: "tokophi:sandbox:store:abc" }, m.opts);
    const c = m.calls[0];
    expect(c.url).toBe("https://partner.test/api/partner/v1/sellers/list");
    expect(H(c)["partner-id"]).toBe("tokophi-fixture");
    expect(H(c).timestamp).toBe("1758790800");
    expect(H(c).signature).toBe(signPartnerRequest({ method: "POST", path: "/api/partner/v1/sellers/list", body: String(c.init.body), timestamp: "1758790800", secret: SECRET }));
    expect(JSON.stringify(c)).not.toContain(SECRET);
    expect(c.init.redirect).toBe("manual");
  });
});

describe("register", () => {
  it("201 new seller: normalised email + phone, the key is returned to the caller", async () => {
    const m = mockFetch(json(201, { success: true, alreadyRegistered: false, data: { sellerId: "s1", email: "owner@example.test", apiKey: "API-AAAABBBBCCCCDDDD" } }));
    const r = await partnerRegisterSeller(REG, m.opts);
    expect(r).toEqual({ ok: true, httpStatus: 201, data: { alreadyRegistered: false, sellerId: "s1", email: "owner@example.test", apiKey: "API-AAAABBBBCCCCDDDD" } });
    expect(JSON.parse(String(m.calls[0].init.body))).toEqual({ name: "Toko Uji", email: "owner@example.test", phone: "6281234567890", externalUserId: REG.externalUserId });
  });

  it("a repeat of the same externalUserId is 200 alreadyRegistered (idempotent)", async () => {
    const m = mockFetch(json(200, { success: true, alreadyRegistered: true, data: { sellerId: "s1", apiKey: "API-AAAABBBBCCCCDDDD" } }));
    expect(await partnerRegisterSeller(REG, m.opts)).toMatchObject({ ok: true, data: { alreadyRegistered: true, sellerId: "s1" } });
  });

  it("409 EMAIL_ALREADY_REGISTERED is a definite refusal (not unknown)", async () => {
    const m = mockFetch(json(409, { success: false, code: "EMAIL_ALREADY_REGISTERED", message: "Email already registered", field: "email" }));
    expect(await partnerRegisterSeller(REG, m.opts)).toEqual({ ok: false, httpStatus: 409, code: "EMAIL_ALREADY_REGISTERED", message: "Email already registered", field: "email", unknown: false });
  });

  it.each([
    ["timeout / network", new TypeError("socket hang up")],
    ["502 HTML (sandbox Cloudflare)", new Response("<html>502</html>", { status: 502 })],
    ["500 INTERNAL_ERROR", json(500, { success: false, code: "INTERNAL_ERROR", message: "x" })],
    ["2xx without sellerId", json(201, { success: true, data: {} })],
    ["a redirect", new Response(null, { status: 302, headers: { location: "https://elsewhere" } })],
  ])("%s → unknown (the seller may exist)", async (_n, r) => {
    const out = await partnerRegisterSeller(REG, mockFetch(r).opts);
    expect(out).toMatchObject({ ok: false, unknown: true });
  });

  it("503 KEY_PROVISIONING_FAILED is a KNOWN partial carrying the sellerId", async () => {
    const m = mockFetch(json(503, { success: false, code: "KEY_PROVISIONING_FAILED", message: "retry", sellerId: "s9" }));
    expect(await partnerRegisterSeller(REG, m.opts)).toMatchObject({ ok: false, code: "KEY_PROVISIONING_FAILED", sellerId: "s9", unknown: false });
  });

  it("429 carries Retry-After seconds; a missing header is null (unknown), never 0", async () => {
    expect(await partnerRegisterSeller(REG, mockFetch(json(429, { success: false, code: "RATE_LIMITED", message: "slow" }, { "Retry-After": "17" })).opts)).toMatchObject({ code: "RATE_LIMITED", retryAfterSec: 17 });
    expect(await partnerRegisterSeller(REG, mockFetch(json(429, { success: false, code: "DAILY_REGISTRATION_LIMIT", message: "day" })).opts)).toMatchObject({ code: "DAILY_REGISTRATION_LIMIT", retryAfterSec: null });
  });

  it("refuses a non-mobile phone and a missing field without a call", async () => {
    const m = mockFetch(json(201, {}));
    expect(await partnerRegisterSeller({ ...REG, phone: "021-555-1234" }, m.opts)).toMatchObject({ ok: false, code: "INVALID_PHONE", httpStatus: 0 });
    expect(await partnerRegisterSeller({ ...REG, email: " " }, m.opts)).toMatchObject({ ok: false, code: "MISSING_FIELDS" });
    expect(m.fn).not.toHaveBeenCalled();
  });

  it("never puts the secret or a seller key in an error message", async () => {
    const m = mockFetch(json(400, { success: false, code: "INVALID_NAME", message: `bad ${SECRET} API-LEAKLEAKLEAKLEAK` }));
    const r = await partnerRegisterSeller(REG, m.opts);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).not.toContain(SECRET);
      expect(r.message).not.toContain("API-LEAKLEAKLEAKLEAK");
    }
  });
});

describe("list / key / regenerate", () => {
  it("list parses sellers and keeps externalUserId for the ownership proof", async () => {
    const m = mockFetch(json(200, { success: true, data: { sellers: [{ sellerId: "s1", externalUserId: "e1", active: true }, { sellerId: "s2", externalUserId: "e2", active: false }], total: 2 } }));
    expect(await partnerListSellers({ size: 500 }, m.opts)).toMatchObject({ ok: true, data: { total: 2, sellers: [{ sellerId: "s1", externalUserId: "e1", active: true }, { sellerId: "s2", active: false }] } });
    expect(JSON.parse(String(m.calls[0].init.body))).toEqual({ size: 200 });
  });

  it("get key must name THIS seller, else unknown", async () => {
    expect(await partnerGetSellerKey("s1", mockFetch(json(200, { success: true, data: { sellerId: "s1", apiKey: "API-K1" } })).opts)).toEqual({ ok: true, httpStatus: 200, data: { sellerId: "s1", apiKey: "API-K1" } });
    expect(await partnerGetSellerKey("s1", mockFetch(json(200, { success: true, data: { sellerId: "s2", apiKey: "API-K2" } })).opts)).toMatchObject({ ok: false, unknown: true });
  });

  it("regenerate returns the new key and DISCARDS callbackSecret; a 5xx is unknown", async () => {
    const r = await partnerRegenerateSellerKey("s1", mockFetch(json(200, { success: true, data: { sellerId: "s1", apiKey: "API-NEW", callbackSecret: "cb-secret" } })).opts);
    expect(r).toEqual({ ok: true, httpStatus: 200, data: { sellerId: "s1", apiKey: "API-NEW" } });
    expect(await partnerRegenerateSellerKey("s1", mockFetch(json(502, { message: "x" })).opts)).toMatchObject({ ok: false, unknown: true });
    expect(await partnerRegenerateSellerKey("s1", mockFetch(json(404, { success: false, code: "SELLER_NOT_FOUND", message: "no" })).opts)).toMatchObject({ ok: false, unknown: false, code: "SELLER_NOT_FOUND" });
  });
});

describe("configuration refusals — nothing is sent", () => {
  it("an env with no Partner origin (production today) throws before any call", async () => {
    const m = mockFetch(json(200, {}));
    await expect(partnerListSellers({}, { ...m.opts, cfg: { ...cfg, env: "production", partnerBase: null } })).rejects.toBeInstanceOf(MengantarPartnerConfigError);
    await expect(partnerListSellers({}, { ...m.opts, cfg: { ...cfg, partnerSecret: null } })).rejects.toBeInstanceOf(MengantarPartnerConfigError);
    expect(m.fn).not.toHaveBeenCalled();
  });

  describe("NODE_ENV=test", () => {
    afterEach(() => vi.unstubAllGlobals());
    it("refuses without an injected fetch and never touches the global one", async () => {
      expect(process.env.NODE_ENV).toBe("test");
      const spy = vi.fn();
      vi.stubGlobal("fetch", spy);
      await expect(partnerListSellers({}, { cfg })).rejects.toThrow(/refused/);
      expect(spy).not.toHaveBeenCalled();
    });
  });
});

describe("helpers", () => {
  // Sandbox 2026-11-12: every non-ASCII letter and "&" → 400 INVALID_NAME, never retried.
  it.each([
    [["Batik Café"], "Batik Cafe"],
    [["Kopi Señor & Co."], "Kopi Senor Co."],
    [["TokoΦ Jaya"], "Toko Jaya"],
    [["  O'Neil_shop@id - 01 "], "O'Neil_shop@id - 01"],
    [["日本", "Siti Ñurhaliza"], "Siti Nurhaliza"],
    [["---", null, ""], "Toko"],
    [["a".repeat(120)], "a".repeat(100)],
  ])("partnerSellerName(%j) → %j", (c, out) => {
    const n = partnerSellerName(...c);
    expect(n).toBe(out);
    expect(n).toMatch(/^[A-Za-z0-9 '\-_.@]{1,100}$/);
  });
  it.each([
    ["0812 3456 7890", "6281234567890"],
    ["+62 812-3456-7890", "6281234567890"],
    ["6281234567890", "6281234567890"],
    ["(0812) 345 678", "62812345678"],
    ["021 555 1234", null],
    ["0812", null],
    ["", null],
    [null, null],
  ])("partnerPhone(%j) → %j", (raw, out) => expect(partnerPhone(raw)).toBe(out));

  it("externalUserId is namespaced per env (the DB CHECK mirrors it)", () => {
    expect(mengantarExternalUserId("u1", "production")).toBe("tokophi:store:u1");
    expect(mengantarExternalUserId("u1", "sandbox")).toBe("tokophi:sandbox:store:u1");
  });
});
