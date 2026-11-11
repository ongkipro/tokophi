import { describe, expect, it } from "vitest";
import { mengantarReadiness, type MengantarReadinessInput } from "./mengantar-readiness";

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
