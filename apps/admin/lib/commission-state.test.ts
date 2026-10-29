import { describe, expect, it } from "vitest";
import { commissionState, COMMISSION_STATE } from "./commission-state";

describe("commissionState", () => {
  it("paid and cancelled win over everything else", () => {
    expect(commissionState({ status: "dibayar", isReady: true, hasEligibleAt: true })).toBe("dibayar");
    expect(commissionState({ status: "batal", isReady: true, hasEligibleAt: true })).toBe("batal");
  });
  it("pending is siap only once the hold window has passed", () => {
    expect(commissionState({ status: "pending", isReady: true, hasEligibleAt: true })).toBe("siap");
    expect(commissionState({ status: "pending", isReady: false, hasEligibleAt: true })).toBe("ditahan");
  });
  it("pending with no hold window yet is still a running order, never payable", () => {
    expect(commissionState({ status: "pending", isReady: false, hasEligibleAt: false })).toBe("belum_selesai");
  });
  it("every state has a label", () => {
    for (const s of ["belum_selesai", "ditahan", "siap", "dibayar", "batal"] as const) expect(COMMISSION_STATE[s].label).toBeTruthy();
  });
});
