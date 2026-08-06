"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ShoppingCart, TrendingDown, RotateCcw, Phone, MessageCircle,Check } from "lucide-react";

import { PageHeader } from "@/components/admin/page-header";
import { EmptyState } from "@/components/admin/empty-state";
import { Card } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Separator } from "@tokophi/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@tokophi/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@tokophi/ui/table";
import { CheckoutStepBadge } from "@/components/admin/pelanggan/checkout-step-badge";
import { useCan } from "@/components/admin/permissions";
import { recordCartContact } from "@/lib/actions/checkout";
import type { AbandonedCart, CheckoutMetrics } from "@/lib/data/checkout";
import { IDR, num, timeAgo } from "@tokophi/lib/format";
import { SearchInput } from "@/components/admin/search-input";

// Rate → "80,0%" (id-ID decimal comma). NOT `pct()`: that one carries a "+"/"−" sign, which is for
// deltas. An abandonment rate is a share, not a change.
const rate = (n: number) => `${(n * 100).toFixed(1).replace(".", ",")}%`;

function itemsLabel(cart: AbandonedCart): string {
  if (cart.items.length === 0) return "—";
  const first = cart.items[0];
  const head = first.qty > 1 ? `${first.name} ×${first.qty}` : first.name;
  return cart.items.length > 1 ? `${head} +${cart.items.length - 1} lainnya` : head;
}

type Tab = "semua" | "punya_wa" | "belum_dihubungi" | "anonim";

export function KeranjangClient({ carts, metrics }: { carts: AbandonedCart[]; metrics: CheckoutMetrics }) {
  const router = useRouter();
  const canContact = useCan("crm:write");
  const [tab, setTab] = React.useState<Tab>("semua");
  const [query, setQuery] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const [busyId, setBusyId] = React.useState<string | null>(null);

  // TRUE totals (SQL counts over the whole 30-day window), not the length of the loaded slice — the
  // table shows the top 100 actionable carts + 40 anonymous ones, and saying "100" where the store
  // has 792 would be the smallest, most tempting lie on this screen.
  const counts: Record<Tab, number> = {
    semua: metrics.abandoned,
    punya_wa: metrics.withPhone,
    belum_dihubungi: metrics.notContacted,
    anonim: metrics.anonymous,
  };

  const rows = React.useMemo(() => {
    let list = carts;
    if (tab === "punya_wa") list = list.filter((c) => c.phone);
    if (tab === "belum_dihubungi") list = list.filter((c) => c.phone && !c.contactedLabel);
    if (tab === "anonim") list = list.filter((c) => !c.phone);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (c) =>
          (c.name ?? "").toLowerCase().includes(q) ||
          (c.phone ?? "").includes(q) ||
          c.items.some((i) => i.name.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [carts, tab, query]);

  // One click = open WhatsApp with the `keranjang` template pre-filled, and record the ATTEMPT.
  // We open the chat; we do not send it, and we cannot see whether it was delivered — so the toast
  // says exactly that, and the row shows "WA dibuka", never "terkirim".
  function contact(cart: AbandonedCart) {
    if (!cart.waHref) return;
    window.open(cart.waHref, "_blank", "noopener,noreferrer");
    if (!canContact) return; // no crm:write → we still open WA, we just cannot log it
    setBusyId(cart.id);
    startTransition(async () => {
      try {
        await recordCartContact(cart.id);
        toast.success("WhatsApp dibuka — dicatat sebagai upaya kontak", {
          description: "Status kirim/baca tidak bisa kami pastikan dari wa.me.",
        });
        router.refresh();
      } catch {
        toast.error("Gagal mencatat upaya kontak");
      } finally {
        setBusyId(null);
      }
    });
  }

  const stats = [
    {
      label: "Keranjang ditinggal",
      value: num(metrics.abandoned),
      icon: ShoppingCart,
      sub: `${IDR(metrics.abandonedValue, { compact: true })} nilai belum jadi · ${metrics.windowDays} hari terakhir`,
    },
    {
      label: "Tingkat ditinggal",
      value: rate(metrics.abandonRate),
      icon: TrendingDown,
      sub: `${num(metrics.abandoned)} ditinggal ÷ ${num(metrics.abandoned + metrics.orders)} checkout (${num(metrics.orders)} jadi pesanan)`,
    },
    {
      // RESCUED, not "pulih". A cart that walked straight through checkout also ends up `pulih` —
      // counting those would report a recovery rate near 100% to a shop that never saved a cart.
      // Only sessions that actually went quiet first (abandoned_at) and then converted count here.
      label: "Diselamatkan",
      value: num(metrics.rescued),
      icon: RotateCcw,
      sub: `${rate(metrics.recoveryRate)} dari ${num(metrics.abandoned + metrics.rescued)} keranjang yang sempat ditinggal · ${IDR(metrics.rescuedValue, { compact: true })} kembali`,
    },
    {
      label: "Punya nomor WA",
      value: num(metrics.withPhone),
      icon: Phone,
      sub: `dari ${num(metrics.abandoned)} keranjang — sisanya anonim, tak bisa dihubungi`,
    },
  ];

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <PageHeader
        title="Keranjang Ditinggal"
        desc="Checkout yang berhenti di tengah jalan. Yang meninggalkan nomor WhatsApp masih bisa diselamatkan."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="gap-0 p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">{s.label}</span>
              <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <s.icon className="size-4" />
              </span>
            </div>
            <div className="mt-3 text-2xl font-bold tracking-tight tabular-nums">{s.value}</div>
            <div className="mt-1 text-xs text-muted-foreground">{s.sub}</div>
          </Card>
        ))}
      </div>

      <Card className="gap-0 py-0">
        <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
            <TabsList>
              {(
                [
                  ["semua", "Semua"],
                  ["punya_wa", "Ada nomor WA"],
                  ["belum_dihubungi", "Belum dihubungi"],
                  ["anonim", "Anonim"],
                ] as Array<[Tab, string]>
              ).map(([k, label]) => (
                <TabsTrigger key={k} value={k} className="gap-1.5">
                  {label}
                  <span className="rounded-full bg-muted-foreground/15 px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                    {counts[k]}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <SearchInput
            label="Cari keranjang ditinggal"
            value={query}
            onValueChange={setQuery}
            placeholder="Cari nama, nomor, atau produk…"
            inputClassName="h-8 w-full sm:w-72"
          />
        </div>

        <Separator />

        <Table>
          {/* Six column labels over zero rows read as "the data failed to load", not as "there is
              nothing here" — the same defect N44 named on the dashboard's recent-orders table. The
              header describes rows; with no rows there is nothing for it to describe. */}
          {rows.length > 0 && (
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4">Pembeli</TableHead>
                <TableHead>Isi keranjang</TableHead>
                <TableHead className="text-right">Nilai</TableHead>
                <TableHead>Berhenti di</TableHead>
                <TableHead className="hidden text-right lg:table-cell">Terakhir aktif</TableHead>
                <TableHead className="pr-4 text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
          )}
          <TableBody>
            {rows.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="pl-4">
                  {c.name ? (
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {c.customerId ? (
                          <Link href={`/pelanggan/${c.customerId}`} className="hover:underline">
                            {c.name}
                          </Link>
                        ) : (
                          c.name
                        )}
                      </div>
                      <div className="truncate text-xs text-muted-foreground tabular-nums">
                        {c.phone ?? "Tanpa nomor"}
                        {c.city ? ` · ${c.city}` : ""}
                      </div>
                    </div>
                  ) : (
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-muted-foreground">Tamu anonim</div>
                      <div className="text-xs text-muted-foreground">Belum mengisi kontak</div>
                    </div>
                  )}
                </TableCell>
                <TableCell className="max-w-[280px]">
                  <div className="truncate text-sm">{itemsLabel(c)}</div>
                  <div className="text-xs text-muted-foreground tabular-nums">{num(c.itemsCount)} item</div>
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{IDR(c.subtotal)}</TableCell>
                <TableCell>
                  <CheckoutStepBadge step={c.step} />
                </TableCell>
                <TableCell className="hidden text-right text-sm text-muted-foreground tabular-nums lg:table-cell">
                  {timeAgo(c.minutesAgo)}
                </TableCell>
                <TableCell className="pr-4 text-right">
                  {c.waHref ? (
                    <div className="flex items-center justify-end gap-2">
                      {c.contactedLabel && (
                        <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
                          <Check className="size-3" /> WA dibuka {c.contactedLabel}
                        </span>
                      )}
                      <Button
                        size="sm"
                        variant={c.contactedLabel ? "outline" : "default"}
                        className={c.contactedLabel ? "gap-1.5" : "gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"}
                        disabled={pending && busyId === c.id}
                        onClick={() => contact(c)}
                      >
                        <MessageCircle className="size-4" />
                        {c.contactedLabel ? "Hubungi lagi" : "Hubungi via WA"}
                      </Button>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">Tidak ada nomor</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {/* An empty window is GOOD NEWS here — nobody walked away mid-checkout — so it does not
                borrow the "your search missed" sentence, and it does not get a CTA: there is nothing
                to press that would put a cart in this list. */}
            {rows.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="p-0">
                  {carts.length === 0 ? (
                    <EmptyState
                      icon={ShoppingCart}
                      title="Tidak ada keranjang ditinggal"
                      desc={`Pembeli yang berhenti di tengah checkout dalam ${metrics.windowDays} hari terakhir muncul di sini, lengkap dengan nomor WhatsApp-nya supaya bisa dihubungi.`}
                    />
                  ) : (
                    <EmptyState
                      kind="filter"
                      title="Tidak ada keranjang yang cocok"
                      desc="Tidak ada keranjang pada tab dan kata kunci ini."
                      action={{
                        label: "Hapus filter",
                        onClick: () => {
                          setTab("semua");
                          setQuery("");
                        },
                      }}
                    />
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        <Separator />
        <div className="flex flex-col gap-1 p-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>
            Menampilkan {num(rows.length)} dari {num(counts[tab])} keranjang ({metrics.windowDays} hari terakhir) — yang
            paling layak ditindaklanjuti lebih dulu
          </span>
          <span>Urutan: ada nomor WA → nilai keranjang, dikoreksi umur</span>
        </div>
      </Card>
    </div>
  );
}
