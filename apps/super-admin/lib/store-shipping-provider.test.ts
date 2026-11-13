import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { codeOnly, textWithoutComments } from "../../../test/source-code";
import {
  createSignupCodeWith,
  setSignupCodeActiveWith,
  setStoreShippingProviderWith,
  SHIPPING_PROVIDER_MIN_RANK,
  type SignupCodeDeps,
  type StoreProviderDeps,
} from "./store-shipping-provider";
import { minRoleForPath } from "./route-roles";

// ADR 0019 — the per-store shipping provider and the signup codes, owner 2026-11-13.
//   A. the DECISIONS against fake deps (no DB): reason required, outcome RE-READ into the audit line,
//      Mengantar queues the account only when none exists (never consent), codes normalised + never deleted;
//   B. the RANK lives in ONE constant: the three actions gate on it first and the `/kode-daftar` floor is it;
//   C. the CALL SITES in `actions.ts` (`"use server"`, not importable here), read as code.

const OP = "owner@tokophi.id";
const STORE = "9f0b7e7c-0000-4000-8000-0000000000aa";

function storeDeps(over: Partial<StoreProviderDeps> & { provider?: string; account?: string } = {}) {
  const d: StoreProviderDeps = {
    read: vi.fn(async () => ({ name: "Toko Uji", provider: over.provider ?? "kiriminaja" })),
    write: vi.fn(async (_id: string, p: string) => p),
    accountState: vi.fn(async () => over.account ?? "none"),
    queueAccount: vi.fn(async () => {}),
    log: vi.fn(async () => {}),
    ...over,
  };
  return d;
}
const lines = (d: { log: unknown }) => (d.log as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[c.length - 1]));

describe("setStoreShippingProviderWith — Super Admin moves ONE store", () => {
  it("refuses an unknown provider and a missing reason, writing nothing", async () => {
    const d = storeDeps();
    expect((await setStoreShippingProviderWith(d, OP, STORE, "jne", "alasan panjang")).ok).toBe(false);
    expect((await setStoreShippingProviderWith(d, OP, STORE, "mengantar", " ok ")).ok).toBe(false);
    expect(d.write).not.toHaveBeenCalled();
    expect(d.log).not.toHaveBeenCalled();
  });

  it("KiriminAja → Mengantar with no account: writes, queues the account WITHOUT consent, audits before → after + reason", async () => {
    const d = storeDeps();
    const r = await setStoreShippingProviderWith(d, OP, STORE, "mengantar", "permintaan pemilik");
    expect(r.ok).toBe(true);
    expect(d.write).toHaveBeenCalledWith(STORE, "mengantar");
    expect(d.queueAccount).toHaveBeenCalledWith(STORE);
    const [line] = lines(d);
    expect(line).toMatch(/KiriminAja → Mengantar oleh owner@tokophi\.id — alasan: permintaan pemilik\. Hasil tersimpan: Mengantar\./);
    expect(line).toMatch(/menunggu persetujuan pemilik/);
  });

  it("to Mengantar with an account that already exists: nothing re-queued (a connected one quotes at once)", async () => {
    const d = storeDeps({ account: "connected" });
    expect((await setStoreShippingProviderWith(d, OP, STORE, "mengantar", "kembali ke Mengantar")).ok).toBe(true);
    expect(d.queueAccount).not.toHaveBeenCalled();
    expect(lines(d)[0]).toMatch(/status connected/);
  });

  it("Mengantar → KiriminAja: the account is left as it is (never queued, never touched)", async () => {
    const d = storeDeps({ provider: "mengantar", account: "connected" });
    expect((await setStoreShippingProviderWith(d, OP, STORE, "kiriminaja", "seller minta KiriminAja")).ok).toBe(true);
    expect(d.queueAccount).not.toHaveBeenCalled();
    expect(d.accountState).not.toHaveBeenCalled();
    expect(lines(d)[0]).toMatch(/Mengantar → KiriminAja/);
  });

  it("reports what the write RETURNED, not what was asked — a no-op write is a refusal, still audited", async () => {
    const d = storeDeps({ write: vi.fn(async () => "kiriminaja") });
    const r = await setStoreShippingProviderWith(d, OP, STORE, "mengantar", "permintaan pemilik");
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/tidak berlaku/);
    expect(d.queueAccount).not.toHaveBeenCalled();
    expect(lines(d)[0]).toMatch(/Hasil tersimpan: KiriminAja\./);
  });

  it("the same provider is a no-op, and an unknown store is refused", async () => {
    const same = storeDeps({ provider: "mengantar" });
    expect((await setStoreShippingProviderWith(same, OP, STORE, "mengantar", "tidak berubah")).ok).toBe(true);
    expect(same.write).not.toHaveBeenCalled();
    const gone = storeDeps({ read: vi.fn(async () => null) });
    expect((await setStoreShippingProviderWith(gone, OP, STORE, "mengantar", "toko hilang")).ok).toBe(false);
    expect(gone.write).not.toHaveBeenCalled();
  });
});

function codeDeps(over: Partial<SignupCodeDeps> = {}) {
  const d: SignupCodeDeps = { insert: vi.fn(async () => "ok" as const), setActive: vi.fn(async (_c: string, a: boolean) => a), log: vi.fn(async () => {}), ...over };
  return d;
}

describe("signup codes — created normalised, never deleted, audited", () => {
  it("normalises the code, keeps the operator, audits the provider", async () => {
    const d = codeDeps();
    const r = await createSignupCodeWith(d, { id: "op-1", email: OP }, "  mitra-sby ", "mengantar", " gudang Surabaya ");
    expect(r.ok).toBe(true);
    expect(d.insert).toHaveBeenCalledWith({ code: "MITRA-SBY", provider: "mengantar", note: "gudang Surabaya", createdBy: "op-1" });
    expect(lines(d)[0]).toMatch(/Kode daftar MITRA-SBY \(pengiriman: Mengantar\) dibuat oleh owner@tokophi\.id/);
    expect(r.message).toContain("/daftar?kode=MITRA-SBY");
  });

  it("refuses a malformed code, an unknown provider, an over-long note, and a duplicate", async () => {
    const d = codeDeps();
    expect((await createSignupCodeWith(d, { id: null, email: OP }, "a b", "mengantar", "")).ok).toBe(false);
    expect((await createSignupCodeWith(d, { id: null, email: OP }, "ABC", "pos", "")).ok).toBe(false);
    expect((await createSignupCodeWith(d, { id: null, email: OP }, "ABC", "mengantar", "x".repeat(201))).ok).toBe(false);
    expect(d.insert).not.toHaveBeenCalled();
    const dup = codeDeps({ insert: vi.fn(async () => "duplicate" as const) });
    const r = await createSignupCodeWith(dup, { id: null, email: OP }, "ABC", "mengantar", "");
    expect(r).toMatchObject({ ok: false });
    expect(r.message).toMatch(/sudah ada/);
    expect(dup.log).not.toHaveBeenCalled();
  });

  it("deactivating reports the RE-READ state; an unknown code is refused", async () => {
    const d = codeDeps();
    expect((await setSignupCodeActiveWith(d, OP, "abc", false)).ok).toBe(true);
    expect(d.setActive).toHaveBeenCalledWith("ABC", false);
    expect(lines(d)[0]).toMatch(/ABC DINONAKTIFKAN oleh/);
    const stuck = codeDeps({ setActive: vi.fn(async () => true) });
    expect((await setSignupCodeActiveWith(stuck, OP, "ABC", false)).ok).toBe(false);
    const none = codeDeps({ setActive: vi.fn(async () => null) });
    expect((await setSignupCodeActiveWith(none, OP, "ABC", false)).ok).toBe(false);
  });
});

// ── B + C ────────────────────────────────────────────────────────────────────────────────────────
const RAW = readFileSync(new URL("./actions.ts", import.meta.url), "utf8");
const ACTIONS = codeOnly(RAW);
const ACTIONS_TEXT = textWithoutComments(RAW);

function actionSource(src: string, name: string): string {
  const opener = `export async function ${name}`;
  const start = src.indexOf(opener);
  expect(start, `${name} not found — this guard is pointed at the wrong file`).toBeGreaterThan(-1);
  const rest = src.slice(start + opener.length);
  const end = rest.indexOf("export async function");
  return end === -1 ? rest : rest.slice(0, end);
}
/** `platformGate(SHIPPING_PROVIDER_MIN_RANK)` is the first thing awaited in the body. */
function gatesOnTheConstant(body: string): boolean {
  const call = textWithoutComments("await platformGate(SHIPPING_PROVIDER_MIN_RANK)");
  const at = body.indexOf(call);
  return at > -1 && !/\bawait\b/.test(body.slice(0, at));
}

describe("ONE rank for the provider + the codes (owner-confirmable; lowering it is one line)", () => {
  it("is OWNER today, and the /kode-daftar route floor IS that constant", () => {
    expect(SHIPPING_PROVIDER_MIN_RANK).toBe("owner");
    expect(minRoleForPath("/kode-daftar")).toBe(SHIPPING_PROVIDER_MIN_RANK);
    const routes = codeOnly(readFileSync(new URL("./route-roles.ts", import.meta.url), "utf8"));
    expect(routes).toMatch(/prefix\s*:\s*"[^"]*"\s*,\s*min\s*:\s*SHIPPING_PROVIDER_MIN_RANK/);
  });

  it.each(["setStoreShippingProvider", "createSignupCode", "setSignupCodeActive"])("%s gates on platformGate(SHIPPING_PROVIDER_MIN_RANK) before anything else is awaited", (name) => {
    expect(gatesOnTheConstant(actionSource(ACTIONS_TEXT, name))).toBe(true);
  });

  it("the guard fires against a mutated copy (a read first, a literal rank, a commented gate)", () => {
    const readFirst = textWithoutComments(`export async function setStoreShippingProvider(a, b, c) { const x = await read(); const gate = await platformGate(SHIPPING_PROVIDER_MIN_RANK); }`);
    const literal = textWithoutComments(`export async function setStoreShippingProvider(a, b, c) { const gate = await platformGate("owner"); }`);
    const commented = textWithoutComments(`export async function setStoreShippingProvider(a, b, c) { // await platformGate(SHIPPING_PROVIDER_MIN_RANK)
      const gate = await platformGate(); }`);
    for (const m of [readFirst, literal, commented]) expect(gatesOnTheConstant(actionSource(m, "setStoreShippingProvider"))).toBe(false);
  });

  it("delegates to the tested decisions with the operator's e-mail; store changes audit on the store", () => {
    expect(actionSource(ACTIONS, "setStoreShippingProvider")).toMatch(/setStoreShippingProviderWith\s*\(\s*storeProviderDeps\s*,\s*gate\s*\.\s*admin\s*\.\s*email/);
    expect(actionSource(ACTIONS, "setSignupCodeActive")).toMatch(/setSignupCodeActiveWith\s*\(\s*signupCodeDeps\s*,\s*gate\s*\.\s*admin\s*\.\s*email/);
    const wiring = ACTIONS.slice(ACTIONS.indexOf("const storeProviderDeps"), ACTIONS.indexOf("export async function setStoreShippingProvider"));
    expect(wiring).toMatch(/log\s*:\s*logStore/);
    // The write reports what it WROTE (`.returning`), and the queued account carries no consent (operator).
    expect(wiring).toMatch(/\.\s*returning\s*\(/);
    expect(wiring).toMatch(/enqueueMengantarConnect\s*\(\s*storeId\s*,\s*\{\s*source\s*:\s*"[^"]*"\s*\}\s*\)/);
  });

  it("createStore no longer queues a Mengantar account (a store is born on KiriminAja)", () => {
    expect(actionSource(ACTIONS, "createStore")).not.toMatch(/enqueueMengantarConnect|kickMengantarConnect/);
  });
});
