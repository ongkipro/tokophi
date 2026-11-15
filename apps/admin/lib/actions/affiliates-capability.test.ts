import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The capability gate of the two new affiliate actions (F-A11 export, seller edit), with the REAL
 * `requireCapability` and the REAL role matrix — only the session, billing and tenant transaction are
 * stubbed. `affiliates.test.ts` replaces `requireCapability` to test the SQL; this file is the other half:
 * a role without `affiliates:write` is refused BEFORE any tenant transaction opens, so not one row is read.
 */

const h = vi.hoisted(() => ({ role: "staff" as string, tenantCalls: 0 }));

vi.mock("@/lib/auth", () => ({ getSession: async () => ({ storeId: "00000000-0000-4000-8000-000000000001", role: h.role, email: "x@example.test" }) }));
vi.mock("@/lib/data/billing", () => ({ getBilling: async () => null }));
vi.mock("@/lib/impersonation", () => ({ logImpersonation: async () => {} }));
vi.mock("@/lib/tenant", () => ({
  withTenant: async () => {
    h.tenantCalls += 1;
    return [];
  },
  withCurrentTenant: async () => {
    h.tenantCalls += 1;
    return [];
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const act = await import("./affiliates");
const range = { from: "2026-11-01", to: "2026-11-14" };
const details = { name: "Sari", phone: "081234567890" };
const id = "00000000-0000-4000-8000-000000000002";

describe("affiliates:write gates the commission export and the affiliate edit", () => {
  beforeEach(() => {
    h.tenantCalls = 0;
  });

  it.each(["staff", "cs", "gudang"])("%s is refused, and no tenant transaction opens", async (role) => {
    h.role = role;
    await expect(act.exportAffiliateCommissionsCsv(range)).rejects.toThrow(/affiliates:write/);
    await expect(act.updateAffiliate(id, details)).rejects.toThrow(/affiliates:write/);
    expect(h.tenantCalls).toBe(0);
  });

  it.each(["owner", "admin", "advertiser"])("%s passes the gate", async (role) => {
    h.role = role;
    const r = await act.exportAffiliateCommissionsCsv(range);
    expect(r.ok && r.rows).toBe(0);
    expect(await act.updateAffiliate(id, details)).toEqual({ ok: false, error: "Affiliate tidak ditemukan." });
    expect(h.tenantCalls).toBe(2);
  });
});
