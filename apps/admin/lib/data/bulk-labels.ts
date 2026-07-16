import "server-only";
import { sql } from "drizzle-orm";
import { withCurrentTenant } from "@/lib/tenant";
import { buildLabelHtml } from "@/components/admin/pesanan/shipping-label";

// Many thermal labels, one printable document.
//
// Reuses `buildLabelHtml` per order — the SAME builder the single-order screen uses, so a bulk label
// and a single label can never say different things about the same parcel. Each one already carries
// its own `@page { size: 100mm 150mm }`, so a thermal printer separates them without help; all this
// does is concatenate them and add a page break between.
//
// It prints ONLY orders with a real `awb`. buildLabelHtml throws without one — deliberately — and
// that throw is caught per order and reported as `skipped`, never swallowed: an order quietly
// missing from a print run is a parcel that quietly does not ship.

export async function getBulkLabels(numbers: string[]): Promise<{ html: string | null; skipped: string[] }> {
  return withCurrentTenant(async (db) => {
    // RLS scopes this to the caller's store: a number from another tenant simply returns no row, so
    // a label cannot be minted for someone else's parcel even by guessing.
    const rows = (await db.execute(sql`
      select o.number, o.awb, o.courier, o.ka_order_id, o.total_idr::int as total,
             coalesce(o.ship_recipient, c.name, '—') as recipient,
             o.ship_phone, o.ship_address, o.ship_postcode,
             coalesce(o.city, '') as city, coalesce(o.province, '') as province,
             st.name as store_name,
             p.method::text as method,
             coalesce((
               select json_agg(json_build_object('qty', li.qty, 'title', li.title, 'variant', li.variant))
               from order_line_items li where li.order_id = o.id
             ), '[]'::json) as items
      from orders o
      left join customers c on c.id = o.customer_id
      left join stores st on st.id = o.store_id
      left join payments p on p.order_id = o.id
      where o.number in ${numbers} and o.awb is not null
    `)) as unknown as Record<string, unknown>[];

    const found = new Set(rows.map((r) => String(r.number)));
    const skipped = numbers.filter((n) => !found.has(n));
    const parts: string[] = [];

    for (const r of rows) {
      const items = (r.items as { qty: number; title: string; variant?: string | null }[]) ?? [];
      const isCod = r.method === "cod";
      try {
        parts.push(
          buildLabelHtml({
            awb: String(r.awb),
            courier: String(r.courier ?? "-"),
            orderNumber: `#${String(r.number)}`,
            storeName: String(r.store_name ?? "Toko"),
            recipient: String(r.recipient),
            destination: [r.ship_address, r.city, r.province, r.ship_postcode].filter(Boolean).join(", "),
            recipientPhone: (r.ship_phone as string) ?? null,
            kaOrderId: (r.ka_order_id as string) ?? null,
            cod: isCod,
            totalLabel: new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(
              Number(r.total ?? 0),
            ),
            paymentLabel: isCod ? "COD (Bayar di Tempat)" : (r.method ? String(r.method).toUpperCase() : "Sudah dibayar"),
            items,
            totalQty: items.reduce((a, i) => a + (i.qty ?? 0), 0),
          }),
        );
      } catch {
        // buildLabelHtml refused (an AWB it cannot encode). Report it rather than print a label with
        // a number nobody can scan.
        skipped.push(String(r.number));
      }
    }
    if (!parts.length) return { html: null, skipped };

    // Each part is a full document from buildLabelHtml; take the <body> of each and stack them so the
    // browser prints one job. The page size comes from the @page rule carried in each part's <style>.
    const bodies = parts.map((p) => p.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? p);
    const head = parts[0].match(/<style[\s\S]*?<\/style>/i)?.[0] ?? "";
    const html = `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Resi (${bodies.length})</title>${head}
<style>.label{page-break-after:always}.label:last-child{page-break-after:auto}</style>
</head><body>${bodies.join("\n")}</body></html>`;
    return { html, skipped };
  });
}
