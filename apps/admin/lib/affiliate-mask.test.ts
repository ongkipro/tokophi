import { describe, expect, it } from "vitest";
import { affiliateContactView, maskEmail, maskTail } from "./affiliate-mask";
import { can } from "./rbac-policy";
import { readFileSync } from "node:fs";

const sari = { phone: "081283098098", email: "sari@gmail.com", bankName: "BCA", bankAccount: "1234567890", bankHolder: "Sari" };

describe("affiliate contact masking (F-A12)", () => {
  it("a viewer without affiliates:write gets no full phone, email or bank account", () => {
    const v = affiliateContactView(sari, false);
    expect(v).toEqual({ phone: "••••8098", email: "s•••@gmail.com", bank: "BCA · ••••7890 · a.n. Sari", contactMasked: true });
    const shipped = JSON.stringify(v);
    for (const secret of ["081283098098", "1234567890", "sari@"]) expect(shipped).not.toContain(secret);
  });

  it("a viewer with affiliates:write sees everything", () => {
    expect(affiliateContactView(sari, true)).toEqual({
      phone: "081283098098", email: "sari@gmail.com", bank: "BCA · 1234567890 · a.n. Sari", contactMasked: false,
    });
  });

  it("short and missing values never leak", () => {
    expect(maskTail("123")).toBe("••••");
    expect(maskEmail("not-an-email")).toBe("••••");
    expect(affiliateContactView({ ...sari, email: null, bankName: null }, false)).toMatchObject({ email: null, bank: null });
  });

  it("staff, cs and gudang are masked; the data layer gates on affiliates:write", () => {
    for (const role of ["staff", "cs", "gudang"]) expect(can(role, "affiliates:write")).toBe(false);
    const data = readFileSync(new URL("./data/affiliates.ts", import.meta.url), "utf8");
    expect(data).toMatch(/can\(session\.role, "affiliates:write"\)/);
    expect(data).toMatch(/affiliateContactView\(a, fullContact\)/);
    expect(data).not.toMatch(/phone: a\.phone/);
  });
});
