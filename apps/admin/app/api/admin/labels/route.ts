import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/rbac";
import { getBulkLabels } from "@/lib/data/bulk-labels";

// Thermal labels for Pengiriman Massal, as ONE printable document.
//
// A route, not a server action, because the client hands the result straight to `window.print()` —
// it needs a document, not serialised props.
//
// It is NOT a public endpoint: `requireCapability("orders:write")` is the boundary (a shipping label
// carries a customer's name, phone and full address; leaking it is leaking the customer). RLS scopes
// the read to the caller's own store, so an order number from another tenant resolves to nothing —
// the label cannot be minted for a parcel that is not yours even if you guess a number.
export async function POST(req: Request) {
  await requireCapability("orders:write");
  const { numbers } = (await req.json()) as { numbers?: string[] };
  if (!Array.isArray(numbers) || !numbers.length) {
    return NextResponse.json({ error: "Tidak ada pesanan yang dipilih." }, { status: 400 });
  }
  const { html, skipped } = await getBulkLabels(numbers.slice(0, 50));
  if (!html) {
    return NextResponse.json(
      { error: "Tidak ada label yang bisa dicetak — resi belum terbit untuk pesanan yang dipilih." },
      { status: 409 },
    );
  }
  // `skipped` is returned, never hidden: an order silently missing from a print run is a parcel that
  // silently does not ship.
  return NextResponse.json({ html, skipped });
}
