import { Handshake, Search } from "lucide-react";
import { db } from "@tokophi/db";
import { platformRouteGate } from "@/lib/platform-auth";
import { RouteDenied } from "@/components/route-denied";
import { AFFILIATE_LIST_LIMIT, listAffiliateAccounts } from "@/lib/affiliate-accounts";
import { Badge } from "@tokophi/ui/badge";
import { Button } from "@tokophi/ui/button";
import { Input } from "@tokophi/ui/input";
import { num } from "@tokophi/lib/format";
import { AffiliateAccountsClient } from "./affiliate-accounts-client";

export const dynamic = "force-dynamic";

/**
 * `/affiliate` — affiliate ACCOUNTS (ADR 0022: affiliates sign in at affiliate.tokophi.com with email +
 * password, separate from merchants and shoppers). The support desk for them while there is no mail
 * provider: find an account, hand over a new password (shown once), or disable it. Store-level affiliate
 * rows (approval, commissions) stay the seller's business in their own panel; this screen only shows
 * which stores an account is bound to.
 *
 * Search is a GET form — the URL is the state, like `/log-sistem`.
 */
export default async function AffiliateAccountsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const gate = await platformRouteGate("/affiliate");
  if (!gate.ok) return <RouteDenied need={gate.need} role={gate.role} reason={gate.reason} landing={gate.landing} />;

  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim().slice(0, 100) ?? "";
  const { rows, total } = await listAffiliateAccounts(db, q);

  return (
    <div className="mx-auto max-w-[1100px] space-y-5">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Handshake className="size-6 text-muted-foreground" aria-hidden /> Akun Affiliate
          </h1>
          <p className="text-sm text-muted-foreground">
            Akun yang dipakai affiliate untuk masuk ke area affiliate TokoΦ. Reset kata sandi hanya untuk pemilik akun yang
            menghubungi kami dari email akunnya; kata sandi baru tampil sekali dan semua sesinya dicabut.
          </p>
        </div>
        <Badge variant="outline" className="w-fit tabular-nums">
          {num(total)} akun{q ? " (tersaring)" : ""}
        </Badge>
      </div>

      <form method="get" action="/affiliate" className="flex flex-wrap items-end gap-2" role="search" aria-label="Cari akun affiliate">
        <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
          Cari email atau nama
          <Input name="q" type="search" defaultValue={q} placeholder="mis. rina@… atau Rina" maxLength={100} />
        </label>
        <Button type="submit" variant="outline">
          <Search data-icon="inline-start" /> Cari
        </Button>
        {q ? <Button nativeButton={false} variant="ghost" render={<a href="/affiliate">Hapus pencarian</a>} /> : null}
      </form>

      <AffiliateAccountsClient
        rows={rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), disabledAt: r.disabledAt?.toISOString() ?? null }))}
        filtered={!!q}
      />
      {total > rows.length && (
        <p className="text-xs text-muted-foreground">
          Menampilkan {num(rows.length)} akun terbaru dari {num(total)} (batas {num(AFFILIATE_LIST_LIMIT)}). Persempit dengan pencarian.
        </p>
      )}
    </div>
  );
}
