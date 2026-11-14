import Link from "next/link";
import { getAccountCustomers } from "@/lib/data/customers";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@tokophi/ui/card";
import { num, timeAgo } from "@tokophi/lib/format";

export const dynamic = "force-dynamic";

// Pelanggan → Akun Pembeli (ADR 0016, BUYER-ACCOUNT-P1). Which of THIS store's customers saved an order
// to a TokoΦ Account, how many, and since when. The merchant projection only: the account behind it
// (email, saved data, other stores, devices) is never read here — `buyer_accounts` has no RLS policy,
// so the tenant role cannot see it even by mistake. Read-only: there is nothing for a Seller to change
// about a buyer's account, so no capability gate beyond the session the (admin) layout already demands.
export default async function AkunPembeliPage() {
  const rows = await getAccountCustomers();
  const saved = rows.reduce((s, r) => s + r.savedOrders, 0);
  return (
    <div>
      <PageHeader
        title="Akun Pembeli"
        desc="Pelanggan yang menyimpan pesanan dari toko Anda ke Akun TokoΦ mereka, untuk memantau status dan resi sendiri."
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Pelanggan terhubung</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{num(rows.length)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Pesanan tersimpan di akun</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{num(saved)}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pelanggan dengan Akun TokoΦ</CardTitle>
          <CardDescription>
            Belanja tetap tidak pernah mewajibkan akun. Setelah checkout, pembeli boleh menyimpan pesanannya ke akun dan
            menyetujui toko Anda ditampilkan di sana. Toko hanya melihat pesanan miliknya sendiri — bukan email, perangkat,
            atau pesanan pembeli di toko lain. Bila pembeli memutus toko Anda, ia kembali tampil sebagai tamu.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="px-5 pb-8 pt-2 text-sm text-muted-foreground">
              Belum ada pelanggan yang menyimpan pesanan ke Akun TokoΦ. Tawaran “Simpan ke Akun TokoΦ” muncul di halaman
              sukses checkout setelah fitur akun diaktifkan untuk platform.
            </p>
          ) : (
            <ul className="divide-y" role="list">
              {rows.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/pelanggan/${r.id}`}
                    className="flex flex-col gap-1 px-5 py-3 transition-colors hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{r.name}</span>
                      <span className="block text-sm text-muted-foreground">
                        {[r.phone, r.city].filter(Boolean).join(" · ") || "—"}
                      </span>
                    </span>
                    <span className="text-sm text-muted-foreground sm:text-right">
                      <span className="block tabular-nums text-foreground">{num(r.savedOrders)} pesanan tersimpan</span>
                      <span className="block">
                        Terhubung {r.linkedDaysAgo === 0 ? "hari ini" : `${num(r.linkedDaysAgo)} hari lalu`} · terakhir disimpan {timeAgo(r.lastSavedMinutesAgo)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
