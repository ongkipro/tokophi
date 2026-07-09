import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getSession } from "@/lib/auth";
import { getFaktur } from "@/lib/data/billing";
import { IDR } from "@tokophi/lib/format";
import { BILLING, baseFromTotal } from "@tokophi/lib/billing";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

const jenis = (a: number) => (a >= 2_000_000 ? "Langganan Tahunan" : a <= 100_000 ? "Langganan Bulan Pertama (promo)" : "Langganan Bulanan");
const fmt = (d: Date | string) => new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });

export default async function FakturPage({ params }: { params: Promise<{ number: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { number } = await params;
  const data = await getFaktur(number);
  if (!data) notFound();
  const { invoice: inv, store, owner } = data;
  const paid = inv.status === "dibayar";
  const { base, ppn, total } = baseFromTotal(inv.amount); // inv.amount is PPN-inclusive

  return (
    <div className="min-h-screen bg-muted/30 p-4 sm:p-8 print:bg-white print:p-0">
      <div className="mx-auto max-w-[800px] space-y-4">
        {/* toolbar (hidden on print) */}
        <div className="flex items-center justify-between print:hidden">
          <Link href="/akun/langganan" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> Kembali ke Langganan
          </Link>
          <PrintButton />
        </div>

        {/* faktur sheet */}
        <div className="rounded-xl border bg-background p-8 shadow-sm print:border-0 print:shadow-none sm:p-10">
          {/* header */}
          <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-6">
            <div>
              <div className="text-2xl font-bold tracking-tight">TokoΦ</div>
              <p className="text-sm text-muted-foreground">Platform commerce · tokophi.com</p>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold tracking-tight">FAKTUR</div>
              <div className="font-mono text-sm text-muted-foreground">{inv.number}</div>
              <div className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${paid ? "bg-emerald-500/12 text-emerald-600" : "bg-amber-500/12 text-amber-600"}`}>
                {paid ? "LUNAS" : "MENUNGGU PEMBAYARAN"}
              </div>
            </div>
          </div>

          {/* meta */}
          <div className="grid grid-cols-2 gap-6 py-6 text-sm">
            <div>
              <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">Ditagihkan kepada</div>
              <div className="font-semibold">{store.name}</div>
              <div className="text-muted-foreground">{owner.name ?? owner.email}</div>
              <div className="text-muted-foreground">{owner.email}</div>
              {store.city && <div className="text-muted-foreground">{store.city}</div>}
            </div>
            <div className="text-right">
              <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">Tanggal terbit</div>
              <div>{fmt(inv.issuedAt)}</div>
              {inv.paidAt && <><div className="mt-2 text-xs font-medium uppercase text-muted-foreground">Tanggal bayar</div><div>{fmt(inv.paidAt)}</div></>}
              {inv.virtualAccount && <><div className="mt-2 text-xs font-medium uppercase text-muted-foreground">Virtual Account</div><div className="font-mono">{inv.virtualAccount}</div></>}
            </div>
          </div>

          {/* line items */}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y text-left text-xs uppercase text-muted-foreground">
                <th className="py-2.5 font-medium">Deskripsi</th>
                <th className="py-2.5 text-right font-medium">Jumlah</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b">
                <td className="py-3">
                  <div className="font-medium">Paket {BILLING.PLAN_NAME}</div>
                  <div className="text-xs text-muted-foreground">{jenis(total)} — semua fitur</div>
                </td>
                <td className="py-3 text-right tabular-nums">{IDR(base)}</td>
              </tr>
            </tbody>
          </table>

          {/* total */}
          <div className="flex justify-end pt-4">
            <div className="w-full max-w-[260px] space-y-2 text-sm">
              <div className="flex justify-between text-muted-foreground"><span>Subtotal (DPP)</span><span className="tabular-nums">{IDR(base)}</span></div>
              <div className="flex justify-between text-muted-foreground"><span>PPN 11%</span><span className="tabular-nums">{IDR(ppn)}</span></div>
              <div className="flex justify-between border-t pt-2 text-base font-bold"><span>Total</span><span className="tabular-nums">{IDR(total)}</span></div>
            </div>
          </div>

          <p className="mt-8 border-t pt-4 text-center text-xs text-muted-foreground">
            Terima kasih telah berlangganan TokoΦ. Faktur ini sah tanpa tanda tangan · dibuat otomatis oleh sistem.
          </p>
        </div>
      </div>
    </div>
  );
}
