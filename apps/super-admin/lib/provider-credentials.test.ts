import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { codeOnly } from "../../../test/source-code";
import { keyError, saveCredentials, switchKiriminajaEnv, testStoredKey, type CredentialDeps } from "./provider-credentials";

// Task 8.33 — provider credentials managed from Super Admin. Two halves, same shape as
// `add-store-user.test.ts` + `payout-transition.test.ts`:
//
//   A. The DECISIONS, driven for real against a STUBBED provider: a key is stored only after it
//      passed a live test; the environment flips only after the TARGET env's key passed; the audit
//      line names the operator and the masked tail and NEVER the key.
//   B. The CALL SITES in `actions.ts` (`"use server"` + `@tokophi/db` at module scope, so it cannot
//      be imported here), read as CODE: both mutating actions gate on `platformGate("owner")` and
//      route through the tested module; the rank floor is the boundary, the hidden button is courtesy.

const KEY = "prod-key-abcdefghijklmnop-9876"; // 30 chars, tail "9876"
const SBX = "sbx-key-abcdefghijklmnop-1111";

function deps(overrides: Partial<CredentialDeps> = {}) {
  const log = vi.fn(async () => {});
  const d: CredentialDeps = {
    rows: async () => ({ kiriminaja: { activeEnv: "sandbox", sandboxKey: SBX, productionKey: KEY }, autolaris: null }),
    env: () => ({ KIRIMINAJA_ENV: "sandbox", KIRIMINAJA_API_KEY: "env-key-abcdefghijkl-0000" }),
    testKiriminaja: vi.fn(async () => ({ ok: true, message: "Terhubung ke KiriminAja (production) — 34 provinsi.", provinces: 34 })),
    testAutolaris: vi.fn(async () => ({ ok: true, message: "Terhubung ke payment gateway — biaya admin Rp700." })),
    writeKiriminajaKey: vi.fn(async () => {}),
    markKiriminajaTested: vi.fn(async () => {}),
    writeKiriminajaActiveEnv: vi.fn(async () => {}),
    writeAutolarisKey: vi.fn(async () => {}),
    markAutolarisTested: vi.fn(async () => {}),
    log,
    ...overrides,
  };
  return d;
}

const logged = (d: CredentialDeps) => (d.log as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));

describe("saveCredentials — stored only after a passed test, audited by e-mail + masked tail", () => {
  it("tests the key against the TARGET env, then writes, stamps and logs", async () => {
    const d = deps();
    const r = await saveCredentials(d, "owner@tokophi.id", "kiriminaja", "production", KEY);
    expect(r.ok).toBe(true);
    // the test call carried THIS key at the production host, not whatever the row held
    expect(d.testKiriminaja).toHaveBeenCalledWith(expect.objectContaining({ env: "production", base: "https://client.kiriminaja.com", key: KEY }));
    expect(d.writeKiriminajaKey).toHaveBeenCalledWith("production", KEY);
    expect(d.markKiriminajaTested).toHaveBeenCalledWith("production");
    const line = logged(d).join("\n");
    expect(line).toContain("owner@tokophi.id");
    expect(line).toContain("…9876");
    expect(line).toContain("production");
  });

  it("REFUSES to store a key that failed its live test — nothing written, the vendor's sentence returned", async () => {
    const d = deps({
      testKiriminaja: vi.fn(async () => ({ ok: false, message: "KiriminAja (production) menolak — HTTP 401: Your IP address 1.2.3.4 were not allowed to access this API" })),
    });
    const r = await saveCredentials(d, "owner@tokophi.id", "kiriminaja", "production", KEY);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("tidak disimpan");
    expect(r.message).toContain("Your IP address 1.2.3.4");
    expect(d.writeKiriminajaKey).not.toHaveBeenCalled();
    expect(d.markKiriminajaTested).not.toHaveBeenCalled();
    expect(logged(d).join("\n")).toContain("DITOLAK");
  });

  it("never lets the key itself into an audit line or a reply — success or refusal", async () => {
    for (const ok of [true, false]) {
      const d = deps({ testKiriminaja: vi.fn(async () => ({ ok, message: "x" })), testAutolaris: vi.fn(async () => ({ ok, message: "y" })) });
      const a = await saveCredentials(d, "owner@tokophi.id", "kiriminaja", "sandbox", KEY);
      const b = await saveCredentials(d, "owner@tokophi.id", "autolaris", "production", KEY);
      for (const s of [...logged(d), a.message, b.message]) {
        expect(s, `ok=${ok}: ${s}`).not.toContain(KEY);
        expect(s).not.toContain(KEY.slice(0, 10));
      }
    }
  });

  it("AutoLaris: one environment — the test uses the env base, the write has no env", async () => {
    const d = deps({ env: () => ({ AUTOLARIS_BASE: "https://al.test" }) });
    const r = await saveCredentials(d, "owner@tokophi.id", "autolaris", "sandbox", KEY);
    expect(r.ok).toBe(true);
    expect(d.testAutolaris).toHaveBeenCalledWith(expect.objectContaining({ base: "https://al.test", key: KEY }));
    expect(d.writeAutolarisKey).toHaveBeenCalledWith(KEY);
    expect(d.markAutolarisTested).toHaveBeenCalled();
    expect(logged(d).join("\n")).toContain("…9876");
  });

  it("refuses a blank, short or space-bearing key before touching the provider", async () => {
    const d = deps();
    for (const bad of ["", "   ", "short", "has space in it and is long enough"]) {
      const r = await saveCredentials(d, "owner@tokophi.id", "kiriminaja", "sandbox", bad);
      expect(r.ok, bad).toBe(false);
    }
    expect(d.testKiriminaja).not.toHaveBeenCalled();
    expect(keyError("a".repeat(16))).toBeNull();
  });
});

describe("switchKiriminajaEnv — the TARGET env's key must pass before active_env moves", () => {
  it("tests the target key against the target host, then flips and logs old → new + tail", async () => {
    const d = deps();
    const r = await switchKiriminajaEnv(d, "owner@tokophi.id", "production");
    expect(r.ok).toBe(true);
    expect(d.testKiriminaja).toHaveBeenCalledWith(expect.objectContaining({ env: "production", base: "https://client.kiriminaja.com", key: KEY }));
    expect(d.writeKiriminajaActiveEnv).toHaveBeenCalledWith("production");
    const line = logged(d).join("\n");
    expect(line).toContain("sandbox → production");
    expect(line).toContain("owner@tokophi.id");
    expect(line).toContain("…9876");
    expect(line).not.toContain(KEY);
    expect(r.message).toContain("pemesanan nyata");
  });

  it("REFUSES the switch when the target key fails its test — active_env untouched, refusal audited", async () => {
    const d = deps({ testKiriminaja: vi.fn(async () => ({ ok: false, message: "HTTP 401: Unauthenticated." })) });
    const r = await switchKiriminajaEnv(d, "owner@tokophi.id", "production");
    expect(r.ok).toBe(false);
    expect(r.message).toContain("Tidak beralih");
    expect(d.writeKiriminajaActiveEnv).not.toHaveBeenCalled();
    expect(logged(d).join("\n")).toContain("DITOLAK");
  });

  it("refuses when there is no key for the target env at all, without calling the provider", async () => {
    const d = deps({
      rows: async () => ({ kiriminaja: { activeEnv: "sandbox", sandboxKey: SBX, productionKey: null }, autolaris: null }),
      env: () => ({}),
    });
    const r = await switchKiriminajaEnv(d, "owner@tokophi.id", "production");
    expect(r.ok).toBe(false);
    expect(d.testKiriminaja).not.toHaveBeenCalled();
    expect(d.writeKiriminajaActiveEnv).not.toHaveBeenCalled();
  });

  it("falls back to the env key for the target when the row has none — the same precedence the booking uses", async () => {
    const d = deps({
      rows: async () => ({ kiriminaja: { activeEnv: "production", sandboxKey: null, productionKey: KEY }, autolaris: null }),
      env: () => ({ KIRIMINAJA_API_KEY: "env-key-abcdefghijkl-0000" }),
    });
    const r = await switchKiriminajaEnv(d, "owner@tokophi.id", "sandbox");
    expect(r.ok).toBe(true);
    expect(d.testKiriminaja).toHaveBeenCalledWith(expect.objectContaining({ env: "sandbox", key: "env-key-abcdefghijkl-0000", keySource: "env" }));
    // an env-sourced key has no row to stamp
    expect(d.markKiriminajaTested).not.toHaveBeenCalled();
  });

  it("is a no-op when already on the target env", async () => {
    const d = deps();
    const r = await switchKiriminajaEnv(d, "owner@tokophi.id", "sandbox");
    expect(r.ok).toBe(true);
    expect(d.testKiriminaja).not.toHaveBeenCalled();
    expect(d.writeKiriminajaActiveEnv).not.toHaveBeenCalled();
  });
});

describe("testStoredKey — re-tests what a slot resolves to and re-stamps only a stored key", () => {
  it("stamps a stored key on success and not an env one", async () => {
    const d = deps();
    expect((await testStoredKey(d, "kiriminaja", "production")).ok).toBe(true);
    expect(d.markKiriminajaTested).toHaveBeenCalledWith("production");
    const e = deps({ rows: async () => ({ kiriminaja: null, autolaris: null }) });
    expect((await testStoredKey(e, "kiriminaja", "sandbox")).ok).toBe(true);
    expect(e.markKiriminajaTested).not.toHaveBeenCalled();
  });
});

// ── B. the call sites ────────────────────────────────────────────────────────────────────────────
const ACTIONS = codeOnly(readFileSync(new URL("./actions.ts", import.meta.url), "utf8"));

function actionSource(src: string, name: string): string {
  const opener = `export async function ${name}`;
  const start = src.indexOf(opener);
  expect(start, `${name} not found — this guard is pointed at the wrong file`).toBeGreaterThan(-1);
  const rest = src.slice(start + opener.length);
  const end = rest.indexOf("export async function");
  return end === -1 ? rest : rest.slice(0, end);
}

describe("actions.ts — both credential mutations are OWNER-rank and go through the tested module", () => {
  it.each(["saveProviderCredentials", "setProviderEnv"])("%s gates on platformGate(\"owner\") as its first await", (name) => {
    const body = actionSource(ACTIONS, name);
    const gate = body.indexOf(codeOnly('await platformGate("owner")'));
    expect(gate, `${name} must call platformGate("owner")`).toBeGreaterThan(-1);
    // nothing else awaited before the gate
    expect(body.slice(0, gate)).not.toMatch(/\bawait\b/);
  });

  it("saveProviderCredentials delegates to saveCredentials; setProviderEnv to switchKiriminajaEnv", () => {
    expect(actionSource(ACTIONS, "saveProviderCredentials")).toMatch(/saveCredentials\s*\(\s*credentialDeps\s*,\s*gate\s*\.\s*admin\s*\.\s*email/);
    expect(actionSource(ACTIONS, "setProviderEnv")).toMatch(/switchKiriminajaEnv\s*\(\s*credentialDeps\s*,\s*gate\s*\.\s*admin\s*\.\s*email/);
  });

  it("the audit sink is logPlatform, and the real provider tests are the deps — never a bare console.log of a key", () => {
    const deps = ACTIONS.slice(ACTIONS.indexOf("const credentialDeps"), ACTIONS.indexOf("const isProviderId"));
    expect(deps).toMatch(/log\s*:\s*logPlatform/);
    expect(deps).toMatch(/testKiriminaja\s*:\s*kaTestConnection/);
    expect(deps).toMatch(/testAutolaris\s*:\s*alTestConnection/);
    for (const name of ["saveProviderCredentials", "setProviderEnv", "testProviderKey"]) {
      expect(actionSource(ACTIONS, name)).not.toMatch(/console\s*\.\s*(log|info|warn|error)/);
    }
  });
});
