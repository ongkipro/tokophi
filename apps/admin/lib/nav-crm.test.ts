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
