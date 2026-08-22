import "server-only";
import { sql } from "drizzle-orm";
import { withCurrentTenant, type Tx } from "@/lib/tenant";
import { buildLabelHtml, composeSenderLine, formatWeight } from "@/components/admin/pesanan/shipping-label";
import { DEFAULT_WEIGHT_GRAMS, MIN_BILLABLE_GRAMS } from "@/lib/shipping-weight";
import { latestPaymentFirst } from "@/lib/data/order-payment";

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
//
// 🔴 ONE ROW PER ORDER, AND ONE DEFINITION OF "THE ORDER'S PAYMENT". This used to be
// `left join payments p on p.order_id = o.id` — an unordered, unlimited join to a table that
// routinely holds MORE THAN ONE row per order (a `gagal` VA beside the COD that was collected; a
// second bill raised after the first expired). The join FANS OUT, so one parcel produced one label
// PER PAYMENT ROW, and `isCod` came from whichever row Postgres happened to emit: measured on real
// Postgres, an order with a failed `va` and a collected `cod` printed **two labels for one AWB**,
// one reading "COD (Bayar di Tempat) — Rp150.000 to collect" and the other "Sudah dibayar". A
// courier scanning the wrong one either collects nothing on a COD parcel or asks a prepaid buyer to
// pay again. `latestPaymentFirst()` (lib/data/order-payment.ts) is the SAME ordering the Pesanan
// list and the order detail use, so this third screen can no longer be the odd one out — and a
// scalar subquery cannot multiply rows. `payments` is deliberately UNALIASED: the shared fragment
// interpolates its columns, which drizzle renders UNQUALIFIED, so an alias would break the
// reference rather than silently reorder.
//
// Split so `bulk-labels.test.ts` can drive the REAL query + the REAL renderer against a throwaway
// Postgres — the same seam `dailyStatsRows` uses, and for the same reason: a test that re-types the
// SQL guards nothing.

export async function getBulkLabels(numbers: string[]): Promise<{ html: string | null; skipped: string[] }> {
  return withCurrentTenant((db) => bulkLabels(db, numbers));
}

export async function bulkLabels(
  db: Tx,
  numbers: string[],
): Promise<{ html: string | null; skipped: string[] }> {
  {
    // RLS scopes this to the caller's store: a number from another tenant simply returns no row, so
    // a label cannot be minted for someone else's parcel even by guessing.
    const rows = (await db.execute(sql`
      select o.number, o.awb, o.courier, o.service_type, s->>'name' as service_name,
             o.ka_order_id, o.total_idr::int as total,
             coalesce(o.ship_recipient, c.name, '—') as recipient,
             o.ship_phone, o.ship_address, o.ship_postcode,
             coalesce(o.city, '') as city, coalesce(o.province, '') as province,
             st.name as store_name,
             ss.sender_phone, ss.sender_address, ss.sender_kecamatan_name, ss.sender_postcode,
             w.grams,
             (select payments.method::text from payments where payments.order_id = o.id
              order by ${latestPaymentFirst()} limit 1)          as method,
             coalesce((
               -- ⚠️ The variant TITLE lives on product_variants (order_line_items has only
               -- variant_id). This used to read li.variant — a column that has never existed —
               -- so getBulkLabels threw 42703 on EVERY call and bulk "Cetak resi" always failed.
               select json_agg(json_build_object('qty', li.qty, 'title', li.title,
                      'variant', pv.title, 'price', li.price_idr::int))
               from order_line_items li
               left join product_variants pv on pv.id = li.variant_id
               where li.order_id = o.id
             ), '[]'::json) as items
      from orders o
      left join customers c on c.id = o.customer_id
      left join stores st on st.id = o.store_id
      left join store_settings ss on ss.store_id = o.store_id
      left join platform_couriers pc on pc.courier = o.courier
      left join lateral jsonb_array_elements(pc.services) s on s->>'type' = o.service_type
      left join lateral (
        -- Same weight rule as weightForOrder(): Σ variant weight × qty, missing weight = the
        -- documented default. The 1 kg billable minimum is applied in JS below, once.
        select sum(coalesce(pv.weight_grams, ${DEFAULT_WEIGHT_GRAMS}) * li.qty)::int as grams
        from order_line_items li
        left join product_variants pv on pv.id = li.variant_id
        where li.order_id = o.id
      ) w on true
      where o.number in ${numbers} and o.awb is not null
    `)) as unknown as Record<string, unknown>[];

    const found = new Set(rows.map((r) => String(r.number)));
    const skipped = numbers.filter((n) => !found.has(n));
    const parts: string[] = [];

    const idr = (n: number) =>
      new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

    for (const r of rows) {
      const items = (r.items as { qty: number; title: string; variant?: string | null; price?: number | null }[]) ?? [];
      const isCod = r.method === "cod";
      try {
        parts.push(
          buildLabelHtml({
            awb: String(r.awb),
            courier: String(r.courier ?? "-"),
            serviceName: (r.service_name as string) ?? (r.service_type as string) ?? null,
            orderNumber: `#${String(r.number)}`,
            storeName: String(r.store_name ?? "Toko"),
            senderLine: composeSenderLine({
              address: r.sender_address as string | null,
              kecamatanName: r.sender_kecamatan_name as string | null,
            }),
            senderPhone: (r.sender_phone as string)?.trim() || null,
            senderPostcode: (r.sender_postcode as string)?.trim() || null,
            recipient: String(r.recipient),
            // Kodepos deliberately NOT glued in here — it rides in destinationPostcode below.
            destination: [r.ship_address, r.city, r.province].filter(Boolean).join(", "),
            destinationPostcode: (r.ship_postcode as string)?.trim() || null,
            recipientPhone: (r.ship_phone as string) ?? null,
            kaOrderId: (r.ka_order_id as string) ?? null,
            cod: isCod,
            totalLabel: idr(Number(r.total ?? 0)),
            paymentLabel: isCod ? "COD (Bayar di Tempat)" : (r.method ? String(r.method).toUpperCase() : "Sudah dibayar"),
            items: items.map((it) => ({ ...it, priceLabel: it.price == null ? null : idr(Number(it.price)) })),
            totalQty: items.reduce((a, i) => a + (i.qty ?? 0), 0),
            // Billable weight — max(actual, 1 kg), the same floor the quote and the booking apply.
            weightLabel: formatWeight(Math.max(MIN_BILLABLE_GRAMS, Number(r.grams ?? 0))),
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
  }
}
