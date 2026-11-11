import { describe, expect, it } from "vitest";
import { mengantarNotice, mengantarReadiness, type MengantarReadinessInput } from "./mengantar-readiness";

const READY: MengantarReadinessInput = { switchOn: true, envNamed: true, state: "connected", hasPickupArea: true, hasPickupAddress: true };

describe("mengantarReadiness — the first broken link, in quoteShipping's order", () => {
  it("everything holds → active", () => {
    expect(mengantarReadiness(READY)).toEqual({ active: true, reason: null, fix: null });
  });

  it("platform switch off, or MENGANTAR_ENV unnamed → not active, nothing the seller can fix", () => {
    for (const x of [{ switchOn: false }, { envNamed: false }]) {
      expect(mengantarReadiness({ ...READY, ...x })).toMatchObject({ active: false, fix: null });
    }
  });

  it("a connected badge is not enough: no pickup address / unbridged area → fix the address", () => {
    expect(mengantarReadiness({ ...READY, hasPickupAddress: false, hasPickupArea: false })).toMatchObject({ active: false, fix: "alamat" });
    expect(mengantarReadiness({ ...READY, hasPickupArea: false })).toMatchObject({ active: false, fix: "alamat", reason: expect.stringContaining("belum dikenali") });
  });

  it("every non-connected state → fix the account (checked before the address)", () => {
    for (const state of ["none", "pending", "registering", "email_taken", "failed", "blocked", "rotating"]) {
      expect(mengantarReadiness({ ...READY, state, hasPickupArea: false })).toMatchObject({ active: false, fix: "akun" });
    }
  });

  it("the default provider is never named to the seller (ADR 0004)", () => {
    const all = [{ switchOn: false }, { state: "none" }, { hasPickupAddress: false }, { hasPickupArea: false }].map((x) => mengantarReadiness({ ...READY, ...x }).reason ?? "");
    for (const r of all) expect(r).not.toMatch(/kiriminaja|autolaris/i);
  });
});

describe("mengantarNotice — the dashboard banner appears only when the viewer can act", () => {
  const not = (x: Partial<MengantarReadinessInput>) => mengantarReadiness({ ...READY, ...x });

  it("no banner when checkout already uses Mengantar, when the platform is not on it, or for a viewer without settings:write", () => {
    expect(mengantarNotice(mengantarReadiness(READY), true)).toBeNull();
    expect(mengantarNotice(not({ switchOn: false, state: "none" }), true)).toBeNull();
    expect(mengantarNotice(not({ envNamed: false, hasPickupArea: false }), true)).toBeNull();
    expect(mengantarNotice(not({ state: "none" }), false)).toBeNull();
  });

  it("an unconnected account → Pengiriman; an unusable address → Alamat (the deep link Pengaturan honours)", () => {
    expect(mengantarNotice(not({ state: "none" }), true)).toMatchObject({ href: "/pengaturan?section=pengiriman" });
    expect(mengantarNotice(not({ state: "email_taken" }), true)).toMatchObject({ href: "/pengaturan?section=pengiriman" });
    const addr = mengantarNotice(not({ hasPickupArea: false }), true);
    expect(addr).toMatchObject({ href: "/pengaturan?section=alamat" });
    expect(addr?.body).toContain("belum dikenali");
  });

  it("names no default provider (ADR 0004)", () => {
    for (const x of [{ state: "none" }, { hasPickupAddress: false }]) {
      const n = mengantarNotice(not(x), true);
      expect(`${n?.title} ${n?.body}`).not.toMatch(/kiriminaja|autolaris/i);
    }
  });
});
