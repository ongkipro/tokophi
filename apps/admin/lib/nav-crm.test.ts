import { describe, expect, it } from "vitest";
import { NAV_GROUPS, crmEnabled, navGroupsFor } from "./nav";

const hrefs = (groups: typeof NAV_GROUPS) => groups.flatMap((g) => g.items.map((i) => i.href));

describe("CRM is visible only on the demo store (owner ruling 2026-11-03)", () => {
  it("is enabled for batiknusantara only, and fails closed on a missing slug", () => {
    expect(crmEnabled("batiknusantara")).toBe(true);
    for (const slug of ["taniniaga", "batiknusantara-2", "BATIKNUSANTARA", "", null, undefined]) expect(crmEnabled(slug)).toBe(false);
  });

  it("drops only the CRM entry from every other store's nav", () => {
    const full = hrefs(NAV_GROUPS);
    expect(full).toContain("/crm");
    expect(hrefs(navGroupsFor("batiknusantara"))).toEqual(full);
    expect(hrefs(navGroupsFor("taniniaga"))).toEqual(full.filter((h) => h !== "/crm"));
    expect(navGroupsFor("taniniaga")).toHaveLength(NAV_GROUPS.length);
  });
});

describe("IA moves 2026-11-16 (owner: Plugin under Tema; Affiliate under Pelanggan)", () => {
  const item = (href: string) => NAV_GROUPS.flatMap((g) => g.items).find((i) => i.href === href);
  it("puts Plugin directly under Tema in Toko Online", () => {
    const toko = NAV_GROUPS.find((g) => g.label === "Toko Online")!.items.map((i) => i.href);
    expect(toko.slice(0, 2)).toEqual(["/tema", "/plugin"]);
  });
  it("files Affiliate (with its badge) under Pelanggan, and no longer under Promo", () => {
    expect(item("/pelanggan")?.children).toContainEqual({ label: "Affiliate", href: "/affiliate", badgeKey: "affiliateMenunggu" });
    expect(item("/diskon")?.children?.map((c) => c.href)).not.toContain("/affiliate");
  });
});
