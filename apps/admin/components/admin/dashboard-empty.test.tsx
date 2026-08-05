import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RecentOrders } from "./recent-orders";
import { LiveActivity } from "./live-activity";

// A brand-new store's dashboard, RENDERED — not grepped.
//
// Measured 2026-08-05 in a browser, logged in as the owner of a store with 0 products and 0 orders:
// "Pesanan Terbaru" was a HEADER-ONLY table (five column labels, `<tbody>` with no rows) and
// "Aktivitas Langsung" was a card title over an empty `<ul>`. Neither says anything. Both read as a
// query that failed rather than as a shop that has not sold anything yet — which is the same family
// as "Penjualan hari ini Rp0 · −100,0%" printed above four orders placed that morning: the screen
// showing a shape where it has no data.
//
// This is a RENDER, not a source scan, because the components can be imported and called — the
// `test/source-code.ts` route is the fallback for claims about markup that is ABSENT from a file
// nothing can import (`.astro` templates, the storefront's h1 floor). Here the empty branch is
// ordinary React, so render it and read the output.
//
// Proved red before it was proved green: with the guard clause removed from `recent-orders.tsx` the
// first assertion fails on `<table`, and with it removed from `live-activity.tsx` the second fails on
// "Belum ada".
describe("the dashboard's empty cards say something", () => {
  it("Pesanan Terbaru renders an explanation, not a header-only table", () => {
    const html = renderToStaticMarkup(<RecentOrders orders={[]} />);
    expect(html).not.toContain("<table");
    expect(html).toContain("Belum ada pesanan");
  });

  it("Aktivitas Langsung renders an explanation, not an empty list", () => {
    const html = renderToStaticMarkup(<LiveActivity items={[]} />);
    expect(html).not.toContain("<ul");
    expect(html).toContain("Belum ada aktivitas");
  });

  // The other half of the claim: the table must still be a table when there ARE orders. A guard clause
  // that swallowed the populated case too would pass every assertion above.
  it("…and still renders the table when there are orders", () => {
    const html = renderToStaticMarkup(
      <RecentOrders
        orders={[
          {
            id: "INV-1",
            customer: "Siti Rahayu",
            city: "Yogyakarta",
            channel: "Web",
            status: "baru",
            total: 150_000,
            minutesAgo: 5,
          } as Parameters<typeof RecentOrders>[0]["orders"][number],
        ]}
      />,
    );
    expect(html).toContain("<table");
    expect(html).toContain("Siti Rahayu");
  });
});
