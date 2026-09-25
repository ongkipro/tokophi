import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { codeOfFile } from "../../../test/source-code";

// Task 8.16 — the platform's prepaid float AT KiriminAja. Three things must hold, and the third is
// the one that turns a number into a lie if it breaks:
//   1. a credit account's balance is read (production, measured 2026-09-23: `{balance: 500000}`);
//   2. a Term-of-Payment account — which answers "Unable to find your endpoint target" — is
//      reported as UNSUPPORTED, never as a balance of zero;
//   3. a transport failure is not cached, so a recovered account is not frozen out for a minute.
// The PIN endpoint is not called at all: three wrong attempts lock the platform account.

vi.mock("server-only", () => ({}));

type Cfg = { env: "sandbox" | "production"; envSource: "db"; base: string; key: string | null; keySource: "db"; orderPrefix: string; orderPrefixSource: "db" };
const state = vi.hoisted(() => ({ cfg: null as unknown as Cfg }));

vi.mock("./provider-config", async (orig) => {
  const real = await orig<typeof import("./provider-config")>();
  return {
    ...real,
    getProviderConfig: async () => ({ kiriminaja: state.cfg, autolaris: { base: "", key: null, keySource: "none" } }),
    providerConfigSync: () => ({ kiriminaja: state.cfg, autolaris: { base: "", key: null, keySource: "none" } }),
  };
});

const cfg = (over: Partial<Cfg> = {}): Cfg => ({
  env: "production",
  envSource: "db",
  base: "https://client.kiriminaja.com",
  key: "prod-key-abcdefghijklmnop",
  keySource: "db",
  orderPrefix: "PHI",
  orderPrefixSource: "db",
  ...over,
});

let calls = 0;
const answer = (body: unknown, status = 200) => {
  calls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      calls += 1;
      return new Response(JSON.stringify(body), { status });
    }),
  );
};

// A distinct key per test: the answer cache is process-global and scoped by env + credential.
let n = 0;
const freshCfg = () => cfg({ key: `prod-key-abcdefghijklmnop-${n++}` });

beforeEach(() => {
  state.cfg = freshCfg();
});
afterEach(() => vi.unstubAllGlobals());

describe("kaCreditBalance", () => {
  it("reads the credit account's balance, and caches it", async () => {
    const { kaCreditBalance } = await import("./kiriminaja");
    answer({ status: true, text: "Success load credit balance", results: { balance: 500000 } });
    expect(await kaCreditBalance()).toEqual({ ok: true, balance: 500000 });
    expect(await kaCreditBalance()).toEqual({ ok: true, balance: 500000 });
    expect(calls).toBe(1);
  });

  it("accepts a numeric string without inventing a number from junk", async () => {
    const { kaCreditBalance } = await import("./kiriminaja");
    answer({ status: true, results: { balance: "125000" } });
    expect(await kaCreditBalance()).toEqual({ ok: true, balance: 125000 });

    state.cfg = freshCfg();
    answer({ status: true, results: { balance: "" } });
    expect(await kaCreditBalance()).toMatchObject({ ok: false, unsupported: false });
  });

  it("reports a Term-of-Payment account as UNSUPPORTED, never as Rp0", async () => {
    const { kaCreditBalance } = await import("./kiriminaja");
    answer({ status: false, text: "Unable to find your endpoint target", endpoint: "balance" });
    const r = await kaCreditBalance();
    expect(r).toMatchObject({ ok: false, unsupported: true });
    expect(r).not.toHaveProperty("balance");
  });

  it("does not cache a transport failure — the next call tries again", async () => {
    const { kaCreditBalance } = await import("./kiriminaja");
    calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => { calls += 1; throw new Error("socket hang up"); }));
    expect(await kaCreditBalance()).toMatchObject({ ok: false, unsupported: false });
    expect(await kaCreditBalance()).toMatchObject({ ok: false, unsupported: false });
    expect(calls).toBe(2);
  });

  it("is scoped per account, like every other answer cache", async () => {
    const { kaCreditBalance } = await import("./kiriminaja");
    answer({ status: true, results: { balance: 500000 } });
    await kaCreditBalance();
    state.cfg = cfg({ env: "sandbox", base: "https://tdev.kiriminaja.com", key: "sandbox-key-abcdefghij" });
    await kaCreditBalance();
    expect(calls).toBe(2);
  });
});

describe("the PIN endpoint is never called (three wrong attempts lock the platform account)", () => {
  it("no source in the repo calls pin/validate or sends a pin with a booking", () => {
    const lib = codeOfFile("packages/lib/src/kiriminaja.ts");
    const action = codeOfFile("apps/admin/lib/actions/shipping.ts");
    for (const src of [lib, action]) {
      expect(src).not.toMatch(/pin\s*\/\s*validate/);
      expect(src).not.toMatch(/payment_method\s*:\s*"credit"/);
    }
    // The hazard is written down where the next reader will look, not only in a task file.
    expect(readFileSync(new URL("./kiriminaja.ts", import.meta.url), "utf8")).toMatch(/THREE wrong PIN attempts/);
  });
});

describe("the booking refusal names an exhausted platform float (Task 8.16)", () => {
  const action = () => codeOfFile("apps/admin/lib/actions/shipping.ts");

  it("checks the balance only on the FAILING path, after the vendor-worded branches", () => {
    // `codeOfFile` strips comments, so the anchors here are CODE: the hint chain inside `if (!r.ok)`.
    const src = action();
    const hintChain = src.indexOf('e . includes ( "prefix" )');
    const call = src.indexOf("await kaCreditBalance ( )");
    expect(hintChain).toBeGreaterThan(0);
    expect(call).toBeGreaterThan(hintChain); // after the branches the vendor already explained
    // and inside the refusal handler, before the id is built for the NEXT booking attempt.
    expect(src.indexOf("const awb = r . awb ?? null")).toBeGreaterThan(call);
  });

  it("treats a missing balance as unknown, not as empty", () => {
    expect(action()).toMatch(/bal \. ok && bal \. balance < serverCost/);
  });
});
