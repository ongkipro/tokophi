import { platformRouteGate } from "@/lib/platform-auth";
import { RouteDenied } from "@/components/route-denied";
import { listMengantarAccounts, listUnknownMengantar } from "@/lib/mengantar-ops";
import { getProviderConfig } from "@tokophi/lib/provider-config";
import { PengirimanClient } from "./pengiriman-client";

export const dynamic = "force-dynamic";

// Mengantar Partner Business API — the operator view of every store's OWN Mengantar seller account
// (state, seller id, last error; retry / key rotation) and the bookings whose outcome is unknown (each
// one blocks its order). There is no platform wallet any more: each store pays from its own Mengantar
// wallet ("Bayar ongkir" is a Seller action). Floor `admin` to LOOK; rotating and releasing refuse
// below `owner` at their own gate.
export default async function PengirimanPage() {
  const gate = await platformRouteGate("/pengiriman");
  if (!gate.ok) return <RouteDenied need={gate.need} role={gate.role} reason={gate.reason} landing={gate.landing} />;
  const env = (await getProviderConfig()).mengantar.env;
  const [accounts, unknown] = await Promise.all([listMengantarAccounts(env), listUnknownMengantar()]);
  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Pengiriman</h1>
        <p className="text-sm text-muted-foreground">
          Mengantar Partner Business API ({env}): akun Mengantar milik setiap toko, dibuat otomatis dengan email pemilik toko. Ongkir toko
          dibayar dari saldo Mengantar toko itu sendiri. Booking “belum diketahui” memblokir pesanannya sampai direkonsiliasi.
        </p>
      </div>
      <PengirimanClient accounts={accounts} unknown={unknown} isOwner={gate.admin.role === "owner"} />
    </div>
  );
}
