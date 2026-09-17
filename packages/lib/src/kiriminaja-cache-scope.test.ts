import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The KiriminAja answer caches must be scoped to the environment AND the credential that produced
// them. Measured 2026-09-17: after Super Admin switched sandbox → production, the sandbox account
// quoted 22 services on a route where the production account quoted 0 — a cache keyed on the route
// alone would keep serving the sandbox's quotes (10 min) and courier roster (24 h) to a process
// that is now talking to production. These tests drive the real client with a stubbed `fetch` and a
// config that changes between calls, the way the Super Admin switch changes it.

vi.mock("server-only", () => ({}));

type Cfg = { env: "sandbox" | "production"; envSource: "db"; base: string; key: string | null; keySource: "db" };
const state = vi.hoisted(() => ({ cfg: null as unknown as Cfg }));

vi.mock("./provider-config", async (orig) => {
  const real = await orig<typeof import("./provider-config")>();
  return {
    ...real,
    getProviderConfig: async () => ({ kiriminaja: state.cfg, autolaris: { base: "", key: null, keySource: "none" } }),
    providerConfigSync: () => ({ kiriminaja: state.cfg, autolaris: { base: "", key: null, keySource: "none" } }),
  };
});

const SANDBOX: Cfg = { env: "sandbox", envSource: "db", base: "https://tdev.kiriminaja.com", key: "sandbox-key-aaaa", keySource: "db" };
const PRODUCTION: Cfg = { env: "production", envSource: "db", base: "https://client.kiriminaja.com", key: "prod-key-bbbb", keySource: "db" };

const rate = (service: string) => ({ service, service_type: "REG", service_name: `${service} Reguler`, group: "regular", cost: "10000", cod: false });

// Each host answers with its own roster, so a served answer names the account it came from.
let calls: string[] = [];
let answers: Record<string, unknown[]> = {};
beforeEach(() => {
  calls = [];
  answers = { [SANDBOX.base]: [rate("jne"), rate("spx")], [PRODUCTION.base]: [] };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const base = Object.keys(answers).find((b) => url.startsWith(b))!;
      calls.push(base);
      return new Response(JSON.stringify({ status: true, text: "ok", results: answers[base] }), { status: 200 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

// A fresh route per test: the answer cache is process-global, which is exactly the property under test.
let route = 9_000;
const quote = async (price: typeof import("./kiriminaja").kaShippingPrice, r: number) =>
  price({ origin: r, destination: r + 1, weight: 1000, itemValue: 50_000 });

describe("kaCacheScope", () => {
  it("differs by env, by host and by key — and never contains the key", async () => {
    const { kaCacheScope } = await import("./kiriminaja");
    const a = kaCacheScope(SANDBOX);
    expect(kaCacheScope(PRODUCTION)).not.toBe(a);
    expect(kaCacheScope({ ...SANDBOX, key: "sandbox-key-rotated" })).not.toBe(a);
    expect(kaCacheScope({ ...SANDBOX, base: "https://other.example" })).not.toBe(a);
    expect(kaCacheScope(SANDBOX)).toBe(a);
    expect(a).not.toContain("sandbox-key");
  });
});

describe("kaShippingPrice cache", () => {
  it("re-asks the vendor after a sandbox → production switch instead of serving the sandbox quote", async () => {
    const { kaShippingPrice } = await import("./kiriminaja");
    const r = route++;
    state.cfg = SANDBOX;
    expect((await quote(kaShippingPrice, r)).results).toHaveLength(2);
    expect((await quote(kaShippingPrice, r)).results).toHaveLength(2);
    expect(calls).toEqual([SANDBOX.base]); // second call served from cache

    state.cfg = PRODUCTION;
    const prod = await quote(kaShippingPrice, r);
    expect(calls).toEqual([SANDBOX.base, PRODUCTION.base]);
    expect(prod.results).toHaveLength(0);
  });

  it("re-asks after the key is rotated inside the same environment", async () => {
    const { kaShippingPrice } = await import("./kiriminaja");
    const r = route++;
    state.cfg = SANDBOX;
    await quote(kaShippingPrice, r);
    state.cfg = { ...SANDBOX, key: "sandbox-key-rotated" };
    await quote(kaShippingPrice, r);
    expect(calls).toEqual([SANDBOX.base, SANDBOX.base]);
  });

  it("sends the request to the same config its cache key was built from", async () => {
    const { kaShippingPrice } = await import("./kiriminaja");
    state.cfg = PRODUCTION;
    await quote(kaShippingPrice, route++);
    expect(calls).toEqual([PRODUCTION.base]);
  });
});

describe("kaServices roster cache", () => {
  it("is scoped per environment and does not cache an empty roster", async () => {
    const { kaServices } = await import("./kiriminaja");

    state.cfg = SANDBOX;
    expect((await kaServices()).services.map((s) => s.courier)).toEqual(["jne", "spx"]);

    // Production's account has no couriers yet: its empty roster must not be answered from the
    // sandbox cache, and must not itself be cached.
    state.cfg = PRODUCTION;
    expect((await kaServices()).services).toHaveLength(0);
    const afterFirstProd = calls.length;

    // The vendor activates couriers on the production account: the very next call sees them.
    answers[PRODUCTION.base] = [rate("sicepat")];
    expect((await kaServices()).services.map((s) => s.courier)).toEqual(["sicepat"]);
    expect(calls.length).toBe(afterFirstProd + 1);

    // A non-empty roster IS cached.
    await kaServices();
    expect(calls.length).toBe(afterFirstProd + 1);
  });
});

describe("empty answers are never cached", () => {
  it("a route quoted 0 services is asked again on the next call", async () => {
    const { kaShippingPrice } = await import("./kiriminaja");
    const r = route++;
    state.cfg = PRODUCTION;
    await quote(kaShippingPrice, r);
    answers[PRODUCTION.base] = [rate("jne")];
    expect((await quote(kaShippingPrice, r)).results).toHaveLength(1);
    expect(calls).toEqual([PRODUCTION.base, PRODUCTION.base]);
  });
});
