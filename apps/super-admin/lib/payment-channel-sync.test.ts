import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { codeOnly } from "../../../test/source-code";
import { planChannelSync, type ExistingChannel, type ProbedChannel } from "./payment-channel-sync";

// 2026-09-17: the owner switched OVO off; list_payment reports OVO available; "Sync" wrote
// `enabled = active` and switched it back on at every checkout, with no audit line. These pin the rule.

const row = (channel: string, enabled: boolean, active: boolean): ExistingChannel => ({ channel, label: channel, enabled, active });
const probe = (code: string, active: boolean, kind = "ewallet"): ProbedChannel => ({ code, label: code, kind, active });

describe("planChannelSync — Sync records the provider, the operator decides the checkout", () => {
  it("never switches ON a channel the operator switched off, even when the provider lists it", () => {
    const plan = planChannelSync([row("OVO", false, true)], [probe("OVO", true)]);
    expect(plan.writes).toEqual([]);
    expect(plan.changes).toEqual([]);
  });

  it("the OVO incident exactly: provider flips inactive → active, operator's OFF survives", () => {
    const plan = planChannelSync([row("OVO", false, false)], [probe("OVO", true)]);
    expect(plan.writes).toEqual([{ op: "update", channel: "OVO", set: { active: true } }]);
    for (const w of plan.writes) if (w.op === "update") expect(w.set).not.toHaveProperty("enabled", true);
  });

  it("switches OFF an offered channel the provider no longer supports, and says so", () => {
    const plan = planChannelSync([row("QRIS", true, true)], [probe("QRIS", false, "qris")]);
    expect(plan.writes).toEqual([{ op: "update", channel: "QRIS", set: { active: false, enabled: false } }]);
    expect(plan.changes.join(" ")).toMatch(/QRIS OFF/);
  });

  it("records a channel seen for the first time as NOT offered", () => {
    const plan = planChannelSync([], [probe("VASEABANK", true, "va")]);
    expect(plan.writes).toEqual([{ op: "insert", channel: "VASEABANK", label: "VASEABANK", kind: "va", active: true, enabled: false }]);
  });

  it("writes nothing when nothing changed, and nothing for a code with no kind", () => {
    expect(planChannelSync([row("VABCA", true, true)], [probe("VABCA", true, "va")]).writes).toEqual([]);
    expect(planChannelSync([], [probe("MYSTERY", true, "")]).writes).toEqual([]);
  });
});

describe("syncPaymentChannels applies the plan and leaves an audit line", () => {
  const src = () => codeOnly(readFileSync(new URL("./actions.ts", import.meta.url), "utf8"));
  const fn = () => {
    const s = src();
    const i = s.search(/export async function syncPaymentChannels/);
    return s.slice(i, s.indexOf("export async function", i + 10));
  };
  const writesEnabledFromProvider = (code: string) => /enabled\s*:\s*p\s*\.\s*active/.test(code);

  it("does not derive `enabled` from the provider", () => {
    expect(writesEnabledFromProvider(fn())).toBe(false);
    expect(writesEnabledFromProvider(codeOnly(".set({ active: p.active, enabled: p.active })"))).toBe(true);
  });

  it("decides through planChannelSync and logs its changes", () => {
    const code = fn();
    expect(/planChannelSync\s*\(/.test(code)).toBe(true);
    expect(/logPlatform\s*\(/.test(code)).toBe(true);
  });
});
