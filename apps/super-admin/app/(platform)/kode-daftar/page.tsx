import { platformRouteGate } from "@/lib/platform-auth";
import { RouteDenied } from "@/components/route-denied";
import { listSignupCodes } from "@/lib/shipping-data";
import { KodeDaftarClient } from "./kode-daftar-client";

export const dynamic = "force-dynamic";

// ADR 0019 — signup codes. Each code decides which shipping provider a self-serve store is created on
// (`/daftar?kode=…`); no code = KiriminAja. Owner, 2026-11-13: "bentuk kode daftar dari super admin aja".
// Floor = SHIPPING_PROVIDER_MIN_RANK (route-roles.ts); the three actions gate on the same constant.
export default async function KodeDaftarPage() {
  const gate = await platformRouteGate("/kode-daftar");
  if (!gate.ok) return <RouteDenied need={gate.need} role={gate.role} reason={gate.reason} landing={gate.landing} />;
  const codes = await listSignupCodes();
  return (
    <div className="mx-auto max-w-[1100px] space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Kode Daftar</h1>
        <p className="text-sm text-muted-foreground">
          Kode yang dimasukkan calon seller di halaman daftar menentukan penyedia pengiriman tokonya dan, bila diisi, potongan
          sekali untuk tagihan langganan pertamanya. Tanpa kode, toko baru memakai KiriminAja dan membayar harga normal. Kode
          tidak pernah dihapus — nonaktifkan bila tidak dipakai lagi; pendaftaran dengan kode nonaktif ditolak, tetapi toko
          yang sudah mendaftar dengannya tetap mendapat potongannya.
        </p>
      </div>
      {/* The Seller app's origin, for the shareable `/daftar?kode=` link (same source as impersonation's). */}
      <KodeDaftarClient codes={codes} signupBase={`${(process.env.ADMIN_URL ?? "http://localhost:3000").replace(/\/+$/, "")}/daftar`} />
    </div>
  );
}
