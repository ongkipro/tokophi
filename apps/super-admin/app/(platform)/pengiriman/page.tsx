import Link from "next/link";
import { KeyRound, Ticket } from "lucide-react";
import { Button } from "@tokophi/ui/button";
import { platformRouteGate } from "@/lib/platform-auth";
import { RouteDenied } from "@/components/route-denied";
import { listMengantarAccounts, listStrandedMengantar, listUnknownMengantar } from "@/lib/mengantar-ops";
import { getProviderStatus } from "@/lib/data";
import { readinessSteps } from "@/lib/mengantar-overview";
import { clearsRank } from "@/lib/platform-rank";
import { SHIPPING_PROVIDER_MIN_RANK } from "@/lib/store-shipping-provider";
import { PengirimanClient } from "./pengiriman-client";

export const dynamic = "force-dynamic";

// Mengantar multi-seller — the operator's ONE screen for it (ADR 0018/0019):
//  · "Kesiapan" — can TokoΦ register another store's Mengantar account right now (env, origin O2,
//    partner credential, encryption key) and is the platform switch on;
//  · every store's OWN Mengantar seller account, with WHY it waits and what to do;
//  · bookings whose outcome is unknown (each blocks its order) and Mengantar orders without a usable account.
// There is no platform wallet: each store pays from its own Mengantar wallet ("Bayar ongkir" is a Seller
// action). Floor `admin` to LOOK; rotating, releasing and the configuration links stay owner-gated at
// their own gates.
export default async function PengirimanPage() {
  const gate = await platformRouteGate("/pengiriman");
  if (!gate.ok) return <RouteDenied need={gate.need} role={gate.role} reason={gate.reason} landing={gate.landing} />;
  const providers = await getProviderStatus();
  const env = providers.mengantar.env;
  const [accounts, unknown, stranded] = await Promise.all([listMengantarAccounts(env), listUnknownMengantar(), listStrandedMengantar(env)]);
  const role = gate.admin.role;
  const canCodes = clearsRank(role, SHIPPING_PROVIDER_MIN_RANK);
  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">Pengiriman · Mengantar</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Toko memakai KiriminAja kecuali dipindah ke Mengantar (halaman toko atau kode daftar). Toko Mengantar mendapat akun Mengantar
            sendiri ({env}), dibuat dengan email pemiliknya setelah ia setuju, dan membayar ongkir dari saldo Mengantar-nya. COD selalu lewat
            KiriminAja.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {canCodes && (
            <Button variant="outline" size="sm" className="gap-1.5" nativeButton={false} render={<Link href="/kode-daftar" />}>
              <Ticket className="size-3.5" /> Kode daftar
            </Button>
          )}
          <Button variant="outline" size="sm" className="gap-1.5" nativeButton={false} render={<Link href="/pengaturan?section=kurir" />}>
            <KeyRound className="size-3.5" /> Kredensial &amp; saklar
          </Button>
        </div>
      </div>
      <PengirimanClient
        accounts={accounts}
        unknown={unknown}
        stranded={stranded}
        steps={readinessSteps(providers)}
        env={env}
        isOwner={role === "owner"}
      />
    </div>
  );
}
