import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buyerAccountEnabled } from "@tokophi/lib/claim-token";
import { NAV_GROUPS, navGroupsFor, settingsSectionVisible } from "./nav";

// TokoΦ Account (ADR 0016) — the Seller surfaces are DORMANT until the feature is ON, and ON has ONE
// server-side definition: `buyerAccountEnabled()` = the claim secret the order API signs with is set
// (≥ 32 chars). OFF ⇒ no nav row, no Pengaturan section, `/pelanggan/akun` 404s, the saves write nothing.
// ON ⇒ all of it is there. Already-saved settings are never touched by the switch.

const h = vi.hoisted(() => ({ withTenant: vi.fn(async () => undefined) }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/rbac", () => ({ requireCapability: async () => ({ storeId: "00000000-0000-4000-8000-000000000001" }) }));
vi.mock("@/lib/auth", () => ({ getSession: async () => null }));
vi.mock("@/lib/tenant", () => ({ withTenant: h.withTenant, withCurrentTenant: vi.fn() }));
vi.mock("@/lib/data/customers", () => ({ getAccountCustomers: async () => [] }));

const SECRET = "s".repeat(40);
const on = () => vi.stubEnv("ACCOUNT_CLAIM_SECRET", SECRET);
const off = () => vi.stubEnv("ACCOUNT_CLAIM_SECRET", "");
const childHrefs = (groups: typeof NAV_GROUPS) => groups.flatMap((g) => g.items.flatMap((i) => (i.children ?? []).map((c) => c.href)));

beforeEach(() => h.withTenant.mockClear());
afterEach(() => vi.unstubAllEnvs());

describe("buyerAccountEnabled — the one definition of ON", () => {
  it("is the order API's claim-secret predicate: unset or < 32 chars ⇒ OFF", () => {
    expect(buyerAccountEnabled({})).toBe(false);
    expect(buyerAccountEnabled({ ACCOUNT_CLAIM_SECRET: "x".repeat(31) })).toBe(false);
    expect(buyerAccountEnabled({ ACCOUNT_CLAIM_SECRET: "x".repeat(32) })).toBe(true);
  });
});

describe("nav + Pengaturan", () => {
  it("OFF: Pelanggan → Akun Pembeli and Layanan Pembeli are absent; nothing else moves", () => {
    const all = childHrefs(NAV_GROUPS);
    expect(all).toContain("/pelanggan/akun");
    for (const slug of ["batiknusantara", "taniniaga"]) {
      const withBuyer = childHrefs(navGroupsFor(slug, { buyerAccounts: true }));
      expect(withBuyer).toContain("/pelanggan/akun");
      expect(childHrefs(navGroupsFor(slug))).toEqual(withBuyer.filter((x) => x !== "/pelanggan/akun"));
      expect(childHrefs(navGroupsFor(slug, { buyerAccounts: false }))).not.toContain("/pelanggan/akun");
    }
    expect(settingsSectionVisible("pembeli", false)).toBe(false);
    expect(settingsSectionVisible("profil", false)).toBe(true);
  });
  it("ON: both are present", () => {
    expect(childHrefs(navGroupsFor("taniniaga", { buyerAccounts: true }))).toContain("/pelanggan/akun");
    expect(settingsSectionVisible("pembeli", true)).toBe(true);
  });
});

describe("/pelanggan/akun answers 404 while OFF", () => {
  it("OFF ⇒ notFound(); ON ⇒ renders", async () => {
    const { default: Page } = await import("../app/(admin)/pelanggan/akun/page");
    off();
    await expect(Page()).rejects.toThrow("NEXT_NOT_FOUND");
    on();
    await expect(Page()).resolves.toBeTruthy();
  });
});

describe("Layanan Pembeli saves write nothing while OFF (saved values stay as they are)", () => {
  it("OFF ⇒ refused before any DB write; ON ⇒ written", async () => {
    const { saveReturnWindow } = await import("./actions/retur");
    const { saveComplaintService } = await import("./actions/pengaduan");
    off();
    expect((await saveReturnWindow({ days: "7" })).ok).toBe(false);
    expect((await saveComplaintService({ days: "3" })).ok).toBe(false);
    expect(h.withTenant).not.toHaveBeenCalled();
    on();
    expect(await saveReturnWindow({ days: "7" })).toEqual({ ok: true, days: 7 });
    expect(await saveComplaintService({ days: "3" })).toEqual({ ok: true, days: 3 });
    expect(h.withTenant).toHaveBeenCalledTimes(2);
  });
});
