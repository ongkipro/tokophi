import { afterEach, describe, expect, it } from "vitest";
import { createCustomHostname, provisioningState } from "./cloudflare-saas";

const originalZone = process.env.CF_SAAS_ZONE_ID;
const originalToken = process.env.CF_SAAS_API_TOKEN;

afterEach(() => {
  if (originalZone === undefined) delete process.env.CF_SAAS_ZONE_ID;
  else process.env.CF_SAAS_ZONE_ID = originalZone;
  if (originalToken === undefined) delete process.env.CF_SAAS_API_TOKEN;
  else process.env.CF_SAAS_API_TOKEN = originalToken;
});

describe("Cloudflare for SaaS custom hostnames", () => {
  it("only activates a domain when both hostname and certificate are active", () => {
    expect(provisioningState({ id: "1", hostname: "shop.example", status: "active", ssl: { status: "pending_deployment" } }).status).toBe("provisioning");
    expect(provisioningState({ id: "1", hostname: "shop.example", status: "pending", ssl: { status: "active" } }).status).toBe("provisioning");
    expect(provisioningState({ id: "1", hostname: "shop.example", status: "active", ssl: { status: "active" } }).status).toBe("active");
  });

  it("turns terminal provider states into an actionable error", () => {
    const state = provisioningState({ id: "1", hostname: "shop.example", status: "pending", ssl: { status: "validation_timed_out" } });
    expect(state.status).toBe("error");
    expect(state.error).toContain("validation_timed_out");
  });

  it("creates an HTTP-validated DV hostname with bearer auth", async () => {
    process.env.CF_SAAS_ZONE_ID = "zone id";
    process.env.CF_SAAS_API_TOKEN = "token";
    let request: { url: string; init?: RequestInit } | undefined;
    const fetcher: typeof fetch = async (url, init) => {
      request = { url: String(url), init };
      return new Response(JSON.stringify({
        success: true,
        result: { id: "host-1", hostname: "shop.example", status: "pending", ssl: { status: "pending_validation" } },
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const result = await createCustomHostname("shop.example", fetcher);

    expect(result.id).toBe("host-1");
    expect(request?.url).toBe("https://api.cloudflare.com/client/v4/zones/zone%20id/custom_hostnames");
    expect(request?.init?.method).toBe("POST");
    expect(request?.init?.headers).toMatchObject({ Authorization: "Bearer token" });
    expect(JSON.parse(String(request?.init?.body))).toEqual({
      hostname: "shop.example",
      ssl: { method: "http", type: "dv", settings: { min_tls_version: "1.2" } },
    });
  });

  it("fails closed when platform credentials are absent", async () => {
    delete process.env.CF_SAAS_ZONE_ID;
    delete process.env.CF_SAAS_API_TOKEN;
    await expect(createCustomHostname("shop.example")).rejects.toThrow("belum dikonfigurasi");
  });
});
