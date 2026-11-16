import { describe, expect, it } from "vitest";
import { accountView, readinessSteps, summarize, type MgAccountFacts } from "./mengantar-overview";

const row = (o: Partial<MgAccountFacts>): MgAccountFacts => ({ provider: "mengantar", state: "connected", lastErrorCode: null, lastError: null, partnerId: "P1", ...o });

describe("accountView — why a store's Mengantar account waits", () => {
  it("names the reason a `pending` row waits instead of a bare 'Antre'", () => {
    expect(accountView(row({ state: "pending", lastErrorCode: "awaiting_consent" }))).toMatchObject({ label: "Menunggu persetujuan pemilik", bucket: "waiting" });
    expect(accountView(row({ state: "pending", lastErrorCode: "awaiting_approval" }))).toMatchObject({ label: "Menunggu toko disetujui", bucket: "waiting" });
    expect(accountView(row({ state: "pending", lastErrorCode: "RATE_LIMITED" })).bucket).toBe("waiting");
  });

  it("a partner configuration that cannot work is a problem, not a wait", () => {
    expect(accountView(row({ state: "pending", lastErrorCode: "configuration_blocked", lastError: "origin…" }))).toMatchObject({ tone: "problem", bucket: "problem", hint: "origin…" });
  });

  it("owner-attached (O11, partner_id NULL) is connected and says so", () => {
    expect(accountView(row({ partnerId: null }))).toMatchObject({ label: "Terhubung · akun owner", bucket: "connected" });
  });

  it("a row whose store moved to KiriminAja is history whatever its state (ADR 0019)", () => {
    expect(accountView(row({ provider: "kiriminaja", state: "connected" })).bucket).toBe("history");
  });

  it("refusals are problems", () => {
    for (const state of ["email_taken", "failed", "blocked"]) expect(accountView(row({ state })).bucket).toBe("problem");
  });
});

describe("accountView.action — only a button that can help", () => {
  it("no key rotation for an owner-attached account (O11) nor for a KiriminAja store's history row", () => {
    expect(accountView(row({})).action).toBe("rotate");
    expect(accountView(row({ partnerId: null })).action).toBeNull();
    expect(accountView(row({ provider: "kiriminaja" })).action).toBeNull();
  });
  it("no retry while the account waits on the owner's consent or store approval", () => {
    expect(accountView(row({ state: "pending", lastErrorCode: "awaiting_consent" })).action).toBeNull();
    expect(accountView(row({ state: "pending", lastErrorCode: "awaiting_approval" })).action).toBeNull();
    expect(accountView(row({ state: "none" })).action).toBe("register");
    expect(accountView(row({ state: "failed" })).action).toBe("register");
  });
});

describe("summarize", () => {
  it("counts only stores on Mengantar", () => {
    const s = summarize([
      row({}),
      row({ state: "pending", lastErrorCode: "awaiting_consent" }),
      row({ state: "email_taken" }),
      row({ provider: "kiriminaja", state: "connected" }),
    ]);
    expect(s).toEqual({ onMengantar: 3, connected: 1, waiting: 1, problem: 1 });
  });
});

describe("readinessSteps — production today (2026-11-16)", () => {
  const slot = { partnerId: null, secretMasked: "—", source: "none" as const, originKnown: false };
  const steps = readinessSteps({
    encryptionAvailable: true,
    shipping: { active: "mengantar", source: "db" },
    mengantar: { env: "production", envNamed: true, ready: false, why: "origin", slots: { production: slot, sandbox: { ...slot, originKnown: true } } },
  });
  const byKey = Object.fromEntries(steps.map((s) => [s.key, s.ok]));

  it("reads the ACTIVE env's slot: production origin unknown blocks registration even when sandbox's is known", () => {
    expect(byKey).toEqual({ env: true, origin: false, partner: false, encryption: true, switch: true });
    expect(steps.find((s) => s.key === "origin")?.detail).toContain("O2");
  });
});
