import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  KA_BASE,
  PROVIDER_CONFIG_TTL_MS,
  _providerConfigCacheForTests,
  getProviderConfig,
  invalidateProviderConfig,
  maskKey,
  providerConfigSync,
  resolveAutolaris,
  resolveKiriminaja,
  setProviderConfigLoader,
} from "./provider-config";

// Task 8.33 — the precedence rule (DB row > env var > default), the mask, and the 60 s cache.
// The resolvers are pure, so every branch is a table row; the cache is driven with an injected
// clock, never a real sleep.

describe("resolveKiriminaja — DB row wins over env, env is the fallback", () => {
  const env = { KIRIMINAJA_ENV: "sandbox", KIRIMINAJA_API_KEY: "env-key-0000" };

  it("uses the row's key for the row's active env, and reports both as db", () => {
    const c = resolveKiriminaja({ row: { activeEnv: "production", productionKey: "prod-key-1234", sandboxKey: "sbx-key-5678" }, env });
    expect(c).toMatchObject({ env: "production", envSource: "db", key: "prod-key-1234", keySource: "db", base: KA_BASE.production });
  });

  it("picks the SANDBOX key when the row says sandbox, even if a production key is stored", () => {
    const c = resolveKiriminaja({ row: { activeEnv: "sandbox", productionKey: "prod-key-1234", sandboxKey: "sbx-key-5678" }, env });
    expect(c).toMatchObject({ env: "sandbox", key: "sbx-key-5678", keySource: "db", base: KA_BASE.sandbox });
  });

  it("falls back to the env key when the row has no key for the active env", () => {
    const c = resolveKiriminaja({ row: { activeEnv: "production", productionKey: null, sandboxKey: "sbx-key-5678" }, env });
    expect(c).toMatchObject({ env: "production", envSource: "db", key: "env-key-0000", keySource: "env" });
  });

  it("treats a blank stored key as absent — whitespace is not a credential", () => {
    const c = resolveKiriminaja({ row: { activeEnv: "sandbox", sandboxKey: "   " }, env });
    expect(c).toMatchObject({ key: "env-key-0000", keySource: "env" });
  });

  it("with no row at all resolves exactly as the old module constants did", () => {
    const c = resolveKiriminaja({ row: null, env: { KIRIMINAJA_ENV: "production", KIRIMINAJA_API_KEY: "env-key-0000" } });
    expect(c).toMatchObject({ env: "production", envSource: "env", key: "env-key-0000", keySource: "env", base: KA_BASE.production });
  });

  it("defaults to SANDBOX when neither row nor env names an environment — the failure mode stays sandbox", () => {
    const c = resolveKiriminaja({ row: null, env: {} });
    expect(c).toMatchObject({ env: "sandbox", envSource: "default", key: null, keySource: "none", base: KA_BASE.sandbox });
  });

  it("ignores an unknown active_env value rather than booking against it", () => {
    const c = resolveKiriminaja({ row: { activeEnv: "staging" }, env: { KIRIMINAJA_ENV: "production" } });
    expect(c).toMatchObject({ env: "production", envSource: "env" });
  });
});

describe("resolveAutolaris", () => {
  it("row key wins; env base is honoured; default base otherwise", () => {
    expect(resolveAutolaris({ row: { key: "al-row-key-1" }, env: { AUTOLARIS_API_KEY: "al-env-key-2" } })).toMatchObject({
      key: "al-row-key-1",
      keySource: "db",
      base: "https://api-h2h.autolaris.com",
    });
    expect(resolveAutolaris({ row: null, env: { AUTOLARIS_API_KEY: "al-env-key-2", AUTOLARIS_BASE: "https://x.test" } })).toMatchObject({
      key: "al-env-key-2",
      keySource: "env",
      base: "https://x.test",
    });
    expect(resolveAutolaris({ row: null, env: {} })).toMatchObject({ key: null, keySource: "none" });
  });
});

describe("maskKey — the only shape of a key that may be logged or shown", () => {
  it("shows the last four characters and nothing else", () => {
    expect(maskKey("abcdefghijklmnop1234")).toBe("…1234");
    expect(maskKey("abcdefghijklmnop1234")).not.toContain("abcd");
  });
  it("shows a dash for nothing and an ellipsis for a key too short to reveal four of", () => {
    expect(maskKey(null)).toBe("—");
    expect(maskKey("")).toBe("—");
    expect(maskKey("   ")).toBe("—");
    expect(maskKey("abc123")).toBe("…");
  });
});

describe("getProviderConfig — injectable loader with a 60 s in-process cache", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.KIRIMINAJA_ENV = "sandbox";
    process.env.KIRIMINAJA_API_KEY = "env-key-0000";
    setProviderConfigLoader(null);
  });
  afterEach(() => {
    setProviderConfigLoader(null);
    for (const k of ["KIRIMINAJA_ENV", "KIRIMINAJA_API_KEY", "AUTOLARIS_API_KEY", "AUTOLARIS_BASE"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.restoreAllMocks();
  });

  it("with no loader registered resolves from env and caches nothing", async () => {
    const c = await getProviderConfig();
    expect(c.kiriminaja).toMatchObject({ key: "env-key-0000", keySource: "env", env: "sandbox" });
    expect(_providerConfigCacheForTests()).toEqual({ cached: false, hasLoader: false });
  });

  it("calls the loader once inside the TTL and again after it", async () => {
    const loader = vi.fn(async () => ({ kiriminaja: { activeEnv: "production", productionKey: "prod-key-1234" }, autolaris: null }));
    setProviderConfigLoader(loader);
    const t0 = 1_000_000;
    const a = await getProviderConfig({ now: t0 });
    expect(a.kiriminaja).toMatchObject({ env: "production", key: "prod-key-1234", keySource: "db" });
    await getProviderConfig({ now: t0 + PROVIDER_CONFIG_TTL_MS - 1 });
    expect(loader).toHaveBeenCalledTimes(1);
    await getProviderConfig({ now: t0 + PROVIDER_CONFIG_TTL_MS });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("invalidateProviderConfig forces the next call back to the loader", async () => {
    const loader = vi.fn(async () => ({ kiriminaja: null, autolaris: { key: "al-row-key-1" } }));
    setProviderConfigLoader(loader);
    await getProviderConfig({ now: 5 });
    invalidateProviderConfig();
    await getProviderConfig({ now: 6 });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("de-duplicates concurrent loads — one DB round-trip, not one per caller", async () => {
    let resolve!: (v: { kiriminaja: null; autolaris: null }) => void;
    const loader = vi.fn(() => new Promise<{ kiriminaja: null; autolaris: null }>((r) => (resolve = r)));
    setProviderConfigLoader(loader);
    const p = Promise.all([getProviderConfig({ now: 1 }), getProviderConfig({ now: 1 }), getProviderConfig({ now: 1 })]);
    resolve({ kiriminaja: null, autolaris: null });
    await p;
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("falls back to env when the loader THROWS, and does not retry inside the TTL", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const loader = vi.fn(async () => {
      throw new Error("db down");
    });
    setProviderConfigLoader(loader);
    const c = await getProviderConfig({ now: 10 });
    expect(c.kiriminaja).toMatchObject({ key: "env-key-0000", keySource: "env" });
    await getProviderConfig({ now: 11 });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("providerConfigSync returns env before the first load and the cached row after it", async () => {
    const loader = vi.fn(async () => ({ kiriminaja: { activeEnv: "production", productionKey: "prod-key-1234" }, autolaris: null }));
    setProviderConfigLoader(loader);
    expect(providerConfigSync().kiriminaja.keySource).toBe("env");
    // the sync call kicked the load off; let it land
    await new Promise((r) => setTimeout(r, 0));
    expect(providerConfigSync().kiriminaja).toMatchObject({ env: "production", keySource: "db" });
  });
});
