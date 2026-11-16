import { describe, expect, it } from "vitest";
import { getActionQueue, getStuckMoney } from "./dashboard";

// DASH-QUEUE-PREDICATE (2026-11-16): the dashboard's order tiles are the Pesanan tabs they open.
// The counts themselves come from `getDashboardOrderCounts()` (same SQL as `TAB_WHERE`, whole table);
// this pins how the dashboard USES them.
const counts = { perluDikirim: 25, perluDikirimValue: 4_250_000, belumBayar: 3 };

describe("Antrian Kerja order tiles", () => {
  const q = getActionQueue(counts, [], [], []);
  const byKey = Object.fromEntries(q.map((i) => [i.key, i]));

  it("Perlu dikirim = the sidebar badge's number, and opens that tab", () => {
    expect(byKey.dikirim).toMatchObject({ count: 25, href: "/pesanan?tab=perlu_dikirim" });
    expect(byKey.dikirim.waiting).toBeFalsy();
  });

  it("Belum bayar is shown but marked as the buyer's move, opening its own tab", () => {
    expect(byKey.baru).toMatchObject({ label: "Belum bayar", count: 3, href: "/pesanan?tab=belum_bayar", waiting: true });
  });

  it("Uang tertahan counts only orders the seller can ship now", () => {
    expect(getStuckMoney(counts)).toEqual({ orders: 25, value: 4_250_000 });
  });
});
