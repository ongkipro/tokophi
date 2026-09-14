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
  try {
    const contentLength = Number(req.headers.get("content-length") ?? "0");
    if (contentLength > 1_000_000) {
      return NextResponse.json({ error: "Payload terlalu besar (max 1MB)." }, { status: 413 });
    }

    await requireCapability("orders:write");
    const { numbers } = (await req.json()) as { numbers?: string[] };
    if (!Array.isArray(numbers) || !numbers.length) {
      return NextResponse.json({ error: "Tidak ada pesanan yang dipilih." }, { status: 400 });
    }
    const { html, skipped, missingSortingCode } = await getBulkLabels(numbers.slice(0, 50));
    if (!html) {
      return NextResponse.json(
        { error: "Tidak ada label yang bisa dicetak — resi belum terbit untuk pesanan yang dipilih." },
        { status: 409 },
      );
    }
    // `skipped` is returned, never hidden: an order silently missing from a print run is a parcel that
    // silently does not ship.
    // `missingSortingCode`: printed, but the courier requires a sorting code that has not been issued.
    return NextResponse.json({ html, skipped, missingSortingCode });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Gagal memproses label.";
    const isForbidden =
      err instanceof Error &&
      (err.name === "ForbiddenError" ||
        err.name === "SuspendedError" ||
        err.message.includes("izin") ||
        err.message.includes("ditangguhkan") ||
        err.message.includes("ditolak"));
    const isUnauthorized = err instanceof Error && (err.name === "UnauthorizedError" || err.message.includes("Unauthorized"));
    const status = isForbidden ? 403 : isUnauthorized ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
