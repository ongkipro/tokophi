import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { codeOnly, textWithoutComments } from "../../../test/source-code";
import { mengantarReadiness, saveMengantarPartnerWith, switchShippingProviderWith, type MengantarDeps } from "./mengantar-credentials";

// Mengantar Partner Business API (0116) — the PARTNER credential + the platform shipping switch.
//
//   A. The DECISIONS against a STUBBED partner probe: the credential is stored only after a passed
//      read-only probe (when the env has a Partner origin); switching TO Mengantar needs a credential
//      AND a Partner origin for the active env; a reason is required; the audit line reports the
//      RE-READ outcome and never the secret.
//   B. The CALL SITES in `actions.ts` (`"use server"`, cannot be imported here), read as CODE: every
//      mutating Mengantar action gates on `platformGate(...)` before anything else is awaited.

const SECRET = "partner-secret-abcdefghijklmnop-4321"; // tail "4321"
const OWNER = "owner@tokophi.id";
const SBX_ROW = { sandboxPartnerId: "partner-test-id", sandboxPartnerSecret: SECRET };

function deps(overrides: Partial<MengantarDeps> = {}) {
  const d: MengantarDeps = {
    rows: async () => ({ kiriminaja: null, autolaris: null, mengantar: SBX_ROW, shipping: { activeProvider: "kiriminaja" } }),
    env: () => ({ MENGANTAR_ENV: "sandbox" }),
    testPartner: vi.fn(async () => ({ ok: true as const })),
    writePartner: vi.fn(async () => {}),
    writeActiveProvider: vi.fn(async (p: string) => p),
    log: vi.fn(async () => {}),
    ...overrides,
  };
  return d;
}
const logged = (d: MengantarDeps) => (d.log as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
const refused = () => vi.fn(async () => ({ ok: false as const, error: "UNAUTHORIZED: bad signature" }));

describe("saveMengantarPartnerWith — stored only after a passed read-only probe", () => {
  it("probes THESE values (sandbox origin), then writes and audits the masked tail + operator", async () => {
    const d = deps();
    const r = await saveMengantarPartnerWith(d, OWNER, "sandbox", " partner-test-id ", `  ${SECRET} `);
    expect(r.ok).toBe(true);
    expect(d.testPartner).toHaveBeenCalledWith(expect.objectContaining({ env: "sandbox", partnerId: "partner-test-id", partnerSecret: SECRET, partnerBase: "https://sandbox.mengantar.com" }));
    expect(d.writePartner).toHaveBeenCalledWith("sandbox", "partner-test-id", SECRET);
    const line = logged(d).join("\n");
    expect(line).toContain(OWNER);
    expect(line).toContain("…4321");
    expect(line).not.toContain(SECRET);
  });

  it("REFUSES to store a credential that failed its probe — nothing written, refusal audited", async () => {
    const d = deps({ testPartner: refused() });
    const r = await saveMengantarPartnerWith(d, OWNER, "sandbox", "partner-test-id", SECRET);
    expect(r.ok).toBe(false);
    expect(d.writePartner).not.toHaveBeenCalled();
    expect(logged(d).join("\n")).toContain("DITOLAK");
  });

  it("production has no Partner origin yet: stored, NOT probed, and the reply says it is untested", async () => {
    const d = deps();
    const r = await saveMengantarPartnerWith(d, OWNER, "production", "partner-test-id", SECRET);
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/belum bisa diuji/);
    expect(d.testPartner).not.toHaveBeenCalled();
    expect(d.writePartner).toHaveBeenCalledWith("production", "partner-test-id", SECRET);
  });

  it.each([
    ["an unknown env", "staging", "partner-test-id", SECRET],
    ["a malformed partner id", "sandbox", "a b", SECRET],
    ["an empty secret", "sandbox", "partner-test-id", "   "],
    ["a short secret", "sandbox", "partner-test-id", "abc"],
  ])("refuses %s without any probe or write", async (_n, env, id, secret) => {
    const d = deps();
    expect((await saveMengantarPartnerWith(d, OWNER, env, id, secret)).ok).toBe(false);
    expect(d.testPartner).not.toHaveBeenCalled();
    expect(d.writePartner).not.toHaveBeenCalled();
  });
});

describe("switchShippingProviderWith — readiness is a partner credential + a Partner origin for the ACTIVE env", () => {
  it("switches to Mengantar with a sandbox credential; the audit says unconnected stores and COD stay on KiriminAja", async () => {
    const d = deps();
    const r = await switchShippingProviderWith(d, OWNER, "mengantar", "uji partner sandbox");
    expect(r.ok).toBe(true);
    expect(d.writeActiveProvider).toHaveBeenCalledWith("mengantar");
    const line = logged(d).join("\n");
    expect(line).toMatch(/KiriminAja → Mengantar/);
    expect(line).toMatch(/COD tetap lewat KiriminAja/);
    expect(line).not.toContain(SECRET);
  });

  it("refuses (and audits) without a credential, and on production while the Partner origin is unknown", async () => {
    const none = deps({ rows: async () => ({ kiriminaja: null, autolaris: null, mengantar: null, shipping: { activeProvider: "kiriminaja" } }) });
    expect((await switchShippingProviderWith(none, OWNER, "mengantar", "alasan cukup")).ok).toBe(false);
    expect(none.writeActiveProvider).not.toHaveBeenCalled();
    const prod = deps({ env: () => ({ MENGANTAR_ENV: "production" }), rows: async () => ({ kiriminaja: null, autolaris: null, mengantar: { productionPartnerId: "p", productionPartnerSecret: SECRET }, shipping: null }) });
    const r = await switchShippingProviderWith(prod, OWNER, "mengantar", "alasan cukup");
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/origin Partner API/);
    expect(prod.writeActiveProvider).not.toHaveBeenCalled();
    expect(logged(prod).join("\n")).toContain("DITOLAK");
  });

  it("needs a reason; reports the RE-READ outcome", async () => {
    const d = deps();
    expect((await switchShippingProviderWith(d, OWNER, "mengantar", "  ab ")).ok).toBe(false);
    const stuck = deps({ writeActiveProvider: vi.fn(async () => "kiriminaja") });
    const r = await switchShippingProviderWith(stuck, OWNER, "mengantar", "alasan cukup");
    expect(r.ok).toBe(false);
    expect(logged(stuck).join("\n")).toMatch(/Hasil tersimpan: KiriminAja/);
  });

  it("switching BACK to KiriminAja is never blocked (rollback stays open)", async () => {
    const d = deps({ rows: async () => ({ kiriminaja: null, autolaris: null, mengantar: null, shipping: { activeProvider: "mengantar" } }) });
    const r = await switchShippingProviderWith(d, OWNER, "kiriminaja", "Mengantar bermasalah, kembali dulu");
    expect(r.ok).toBe(true);
    expect(d.writeActiveProvider).toHaveBeenCalledWith("kiriminaja");
  });

  it("mengantarReadiness mirrors the switch for the card", () => {
    expect(mengantarReadiness({ kiriminaja: null, autolaris: null, mengantar: SBX_ROW }, { MENGANTAR_ENV: "sandbox" }).ready).toBe(true);
    expect(mengantarReadiness({ kiriminaja: null, autolaris: null, mengantar: null }, { MENGANTAR_ENV: "sandbox" })).toMatchObject({ ready: false });
  });

  it("refuses (and audits) while MENGANTAR_ENV is UNSET — a deploy that forgot it must not send real checkouts to the sandbox", async () => {
    expect(mengantarReadiness({ kiriminaja: null, autolaris: null, mengantar: SBX_ROW }, {})).toMatchObject({ ready: false, why: expect.stringMatching(/MENGANTAR_ENV belum diset/) });
    const d = deps({ env: () => ({}) });
    const r = await switchShippingProviderWith(d, OWNER, "mengantar", "alasan cukup");
    expect(r.ok).toBe(false);
    expect(d.writeActiveProvider).not.toHaveBeenCalled();
    expect(logged(d).join("\n")).toContain("DITOLAK");
  });
});

// ── B. call sites ────────────────────────────────────────────────────────────────────────────────
const RAW = readFileSync(new URL("./actions.ts", import.meta.url), "utf8");
const ACTIONS = codeOnly(RAW);
// The RANK is a string literal (`"owner"`), and `codeOnly` inerts literal contents — "owner" and
// "admin" are both five characters and inert to the same thing. So the gate check alone reads
// `textWithoutComments` (comments still cannot satisfy it); everything else reads `codeOnly`.
const ACTIONS_TEXT = textWithoutComments(RAW);

function actionSource(src: string, name: string): string {
  const opener = `export async function ${name}`;
  const start = src.indexOf(opener);
  expect(start, `${name} not found — this guard is pointed at the wrong file`).toBeGreaterThan(-1);
  const rest = src.slice(start + opener.length);
  const end = rest.indexOf("export async function");
  return end === -1 ? rest : rest.slice(0, end);
}

/** `platformGate(<rank>)` is the first thing awaited in the action's body. */
function gatesFirst(body: string, rank: "owner" | null): boolean {
  // Normalised the same way as the source (the lexer re-spaces tokens).
  const call = textWithoutComments(rank ? `await platformGate("${rank}")` : "await platformGate()");
  const at = body.indexOf(call);
  return at > -1 && !/\bawait\b/.test(body.slice(0, at));
}

describe("actions.ts — Mengantar actions gate first and route through the tested module", () => {
  it.each(["saveMengantarPartner", "setShippingProvider", "rotateStoreMengantar", "reconcileMengantarBooking"])("%s gates on platformGate(\"owner\") before anything else is awaited", (name) => {
    expect(gatesFirst(actionSource(ACTIONS_TEXT, name), "owner")).toBe(true);
  });

  it("retryStoreMengantar is admin rank (re-queues a registration, never touches a key), still gated first", () => {
    expect(gatesFirst(actionSource(ACTIONS_TEXT, "retryStoreMengantar"), null)).toBe(true);
  });

  it("the guard fires against a mutated copy (a read before the gate, or no owner rank)", () => {
    const readFirst = textWithoutComments(`export async function setShippingProvider(p, r) { const rows = await loadProviderRows(); const gate = await platformGate("owner"); }`);
    const adminRank = textWithoutComments(`export async function setShippingProvider(p, r) { const gate = await platformGate("admin"); }`);
    const commented = textWithoutComments(`export async function setShippingProvider(p, r) { // await platformGate("owner")
      const gate = await platformGate(); }`);
    expect(gatesFirst(actionSource(readFirst, "setShippingProvider"), "owner")).toBe(false);
    expect(gatesFirst(actionSource(adminRank, "setShippingProvider"), "owner")).toBe(false);
    expect(gatesFirst(actionSource(commented, "setShippingProvider"), "owner")).toBe(false);
  });

  it("delegates to the tested decisions with the operator's e-mail, audits via logPlatform, never console-logs", () => {
    expect(actionSource(ACTIONS, "saveMengantarPartner")).toMatch(/saveMengantarPartnerWith\s*\(\s*mengantarDeps\s*,\s*gate\s*\.\s*admin\s*\.\s*email/);
    expect(actionSource(ACTIONS, "setShippingProvider")).toMatch(/switchShippingProviderWith\s*\(\s*mengantarDeps\s*,\s*gate\s*\.\s*admin\s*\.\s*email/);
    const wiring = ACTIONS.slice(ACTIONS.indexOf("const mengantarDeps"), ACTIONS.indexOf("export async function saveMengantarPartner"));
    expect(wiring).toMatch(/log\s*:\s*logPlatform/);
    expect(wiring).toMatch(/testPartner\s*:/);
    expect(wiring).toMatch(/partnerListSellers\s*\(/);
    expect(wiring).toMatch(/writeActiveProvider\s*:\s*writeActiveShippingProvider/);
    for (const name of ["saveMengantarPartner", "setShippingProvider", "retryStoreMengantar", "rotateStoreMengantar"]) {
      expect(actionSource(ACTIONS, name)).not.toMatch(/console\s*\.\s*(log|info|warn|error)/);
    }
  });
});
