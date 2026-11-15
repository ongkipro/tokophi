/**
 * The Kelola wire format. Cases ported from AdsBookCMS `src/plugins/kelola/sync.test.ts` @ 1134137
 * (node:test → vitest, nothing else changed in what they assert), plus TokoΦ's deliberate additions
 * (`gratisOngkir`, `kelurahan`, timeout, redaction, response classes).
 */
import { describe, expect, it } from "vitest";
import {
  KELOLA_PUSH_TIMEOUT_MS,
  classifyKelolaResponse,
  kelolaLeadPayload,
  kelolaLeadUrl,
  kelolaOrderPayload,
  maskKelolaWebhookUrl,
  normalizeKelolaWebhookUrl,
  redactKelola,
  signKelolaBody,
  testKelolaConnection,
  type KelolaOrderRow,
} from "./wire";

const config = { url: "https://kelola.test/api/public/toko/order/twh_x", secret: "testsecret" };

describe("Kelola wire format (ported from AdsBookCMS)", () => {
  it("signature matches Kelola's verifier (its Mengantar test vector)", async () => {
    const body = '{"cnote_no":"JNE1234567890","order_id":"ORD-000123","courier":"JNE","status_category":"DELIVERED"}';
    expect(await signKelolaBody("testsecret", "1787548800000", body)).toBe(
      "05826dec707ea7164801d952cb7eaf7ce9adc0c8aa0b93366480434164a1a111",
    );
  });

  it("only an HTTPS Kelola order-webhook URL is accepted, and its token is masked", () => {
    expect(normalizeKelolaWebhookUrl(" https://kelolatim.com/api/public/toko/order/twh_abcdef123456 ")).toBe(
      "https://kelolatim.com/api/public/toko/order/twh_abcdef123456",
    );
    for (const bad of [
      "http://kelolatim.com/api/public/toko/order/twh_x",
      "https://kelolatim.com/api/public/toko/order/",
      "https://kelolatim.com/api/public/toko/order/twh_x?debug=1",
      "https://kelolatim.com/somewhere/else",
      "not a url",
      42,
    ]) expect(normalizeKelolaWebhookUrl(bad), String(bad)).toBeNull();
    expect(maskKelolaWebhookUrl("https://kelolatim.com/api/public/toko/order/twh_abcdef123456")).toBe(
      "https://kelolatim.com/api/public/toko/order/twh_…3456",
    );
  });

  it("SSRF / PII egress: only Kelola's own origin is accepted (TokoΦ deviation from the port)", () => {
    for (const bad of [
      "https://kelola.test/api/public/toko/order/twh_x", // any other host
      "https://10.0.0.5/api/public/toko/order/twh_x", // private IP literal
      "https://127.0.0.1/api/public/toko/order/twh_x",
      "https://localhost/api/public/toko/order/twh_x",
      "https://[::1]/api/public/toko/order/twh_x",
      "https://admin:3000/api/public/toko/order/twh_x", // the deploy network
      "https://kelolatim.com.evil.tld/api/public/toko/order/twh_x", // suffix trick
      "https://evil.kelolatim.com/api/public/toko/order/twh_x", // undocumented subdomain
      "https://kelolatim.com@evil.tld/api/public/toko/order/twh_x", // userinfo trick
      "https://user:pw@kelolatim.com/api/public/toko/order/twh_x", // credentials in the URL
      "https://kelolatim.com:8443/api/public/toko/order/twh_x", // non-default port
      "https://kelolatim.com/api/public/toko/order/twh_x#frag",
    ]) expect(normalizeKelolaWebhookUrl(bad), bad).toBeNull();
    // Host matching is case-insensitive by URL parsing, never by a looser rule of ours.
    expect(normalizeKelolaWebhookUrl("https://KELOLATIM.com/api/public/toko/order/twh_x")).toBe(
      "https://kelolatim.com/api/public/toko/order/twh_x",
    );
  });

  it("the connection test's message never carries Kelola's response body", async () => {
    const chatty = (async () => new Response("SECRET-BODY internal stack trace", { status: 500 })) as unknown as typeof fetch;
    const r = await testKelolaConnection({ url: "https://kelolatim.com/api/public/toko/order/twh_x", secret: "s" }, chatty);
    expect(r).toEqual({ ok: false, message: "Kelola membalas HTTP 500." });
  });

  it("the lead URL sits beside the order URL", () => {
    expect(kelolaLeadUrl("https://kelolatim.com/api/public/toko/order/twh_abc")).toBe(
      "https://kelolatim.com/api/public/toko/lead/twh_abc",
    );
  });

  it("connection test signs an empty body and reads Kelola's answer", async () => {
    const answer = (status: number) => (async (_url: string, init: RequestInit) => {
      const headers = new Headers(init.headers);
      expect(init.body).toBe("{}");
      expect(headers.get("x-signature")).toBe(await signKelolaBody(config.secret, headers.get("x-timestamp")!, "{}"));
      return new Response("{}", { status });
    }) as unknown as typeof fetch;
    expect((await testKelolaConnection(config, answer(400))).ok).toBe(true);
    expect((await testKelolaConnection(config, answer(401))).message).toMatch(/Secret tidak cocok/);
    expect((await testKelolaConnection(config, answer(404))).message).toMatch(/tidak mengenal URL/);
    const down = (async () => { throw new Error("connect ECONNREFUSED"); }) as unknown as typeof fetch;
    expect((await testKelolaConnection(config, down)).message).toMatch(/ECONNREFUSED/);
  });
});

const order: KelolaOrderRow = {
  order_number: "TP-1001",
  created_at: "2026-11-13T18:30:00.000Z", // 01:30 WIB on the 14th
  customer_name: "Siti Aminah",
  customer_phone: "6281234567890",
  address: "Jl. Melati No. 12 RT 03 RW 05",
  kelurahan: "Sinduadi",
  province: "DI Yogyakarta",
  city: "Sleman",
  district: "Mlati",
  postal_code: "55284",
  shipping_cost: 12000,
  discount_amount: null,
  total_amount: 162000,
  payment_method: "cod",
};
const items = [{ sku: "BTK-01-M", name: "Batik Parang - M", quantity: 2, unit_price: 75000, weight_grams: 300 }];

describe("Kelola order + lead payloads", () => {
  it("maps a COD order: WIB date, codValue = total, berat = Σ weight × qty", () => {
    const p = kelolaOrderPayload(order, items);
    expect(p).toMatchObject({
      code: "TP-1001",
      date: "2026-11-14",
      payment: "cod",
      codValue: 162000,
      ongkir: 12000,
      discount: 0,
      berat: 600,
      kelurahan: "Sinduadi",
      kecamatan: "Mlati",
      items: [{ sku: "BTK-01-M", name: "Batik Parang - M", qty: 2, price: 75000 }],
    });
    expect(p.gratisOngkir).toBeUndefined();
  });

  it("a prepaid order is `transfer` with no codValue", () => {
    const p = kelolaOrderPayload({ ...order, payment_method: "va" }, items);
    expect(p.payment).toBe("transfer");
    expect(p.codValue).toBeNull();
  });

  it("Rp0 shipping is sent as gratisOngkir — Kelola would otherwise re-price it", () => {
    expect(kelolaOrderPayload({ ...order, shipping_cost: 0 }, items).gratisOngkir).toBe(true);
  });

  it("a lead omits empty fields and a zero value", () => {
    const p = kelolaLeadPayload({
      code: "sess-1", customer_name: "Budi", customer_phone: "6281111111111", address: "",
      province: "", city: "", district: "", total_amount: 0, source_page_path: null, product: null,
    });
    expect(p).toEqual({ code: "sess-1", customerName: "Budi", customerPhone: "6281111111111" });
  });
});

describe("TokoΦ additions", () => {
  it("every push response maps to exactly one outcome (spec §1.5)", () => {
    expect(classifyKelolaResponse(201)).toBe("synced");
    expect(classifyKelolaResponse(200)).toBe("synced");
    expect(classifyKelolaResponse(400)).toBe("gave_up");
    expect(classifyKelolaResponse(401)).toBe("broken");
    expect(classifyKelolaResponse(404)).toBe("broken");
    for (const s of [301, 409, 429, 500, 502, 503]) expect(classifyKelolaResponse(s), String(s)).toBe("retry");
  });

  it("the POST timeout stays far below the 5-minute send lease", () => {
    expect(KELOLA_PUSH_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
  });

  it("the token and the secret never survive into a message", () => {
    const cfg = { url: "https://kelolatim.com/api/public/toko/order/twh_SECRET_TOKEN", secret: "s3cr3t-value" };
    const out = redactKelola(`POST ${cfg.url} failed with s3cr3t-value and twh_SECRET_TOKEN`, cfg);
    expect(out).not.toContain("twh_SECRET_TOKEN");
    expect(out).not.toContain("s3cr3t-value");
  });

  it("a network error from the connection test is redacted", async () => {
    const cfg = { url: "https://kelolatim.com/api/public/toko/order/twh_LEAKY", secret: "x" };
    const boom = (async (url: string) => { throw new Error(`fetch failed for ${url}`); }) as unknown as typeof fetch;
    expect((await testKelolaConnection(cfg, boom)).message).not.toContain("twh_LEAKY");
  });
});
