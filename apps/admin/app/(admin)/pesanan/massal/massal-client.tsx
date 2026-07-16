"use client";
import * as React from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Printer, PackageCheck, RefreshCw, Loader2, Info } from "lucide-react";
import { Card } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Badge } from "@tokophi/ui/badge";
import { Checkbox } from "@tokophi/ui/checkbox";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@tokophi/ui/table";
import { PageHeader } from "@/components/admin/page-header";
import { useCan } from "@/components/admin/permissions";
import { ResponsiveTable, DataCard, DataRow } from "@/components/admin/responsive-table";
import { IDR } from "@tokophi/lib/format";
import type { BulkShippingResult, BulkFilters, BulkOrderRow } from "@/lib/data/bulk-shipping";
import { bulkGenerateResi, bulkFetchResi, markLabelsPrinted } from "@/lib/actions/bulk-shipping";

// Pengiriman Massal. Three verbs, in the order physics forces:
//   Generate resi → book the pickup KiriminAja (awb comes back NULL — normal)
//   Ambil resi    → poll until the courier issues the waybill
//   Cetak         → 100×150mm thermal labels, one @page each (buildLabelHtml)
// The buttons are gated on the row's real state, never on hope: you cannot print what has no AWB,
// because buildLabelHtml refuses — correctly — to invent one.

const GROUP_LABEL: Record<string, string> = {
  one_day: "1 Hari", next_day: "Next Day", regular: "Reguler", economy: "Ekonomi", cargo: "Cargo",
};

export function MassalClient({ data, filters }: { data: BulkShippingResult; filters: BulkFilters }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const canWrite = useCan("orders:write");
  const [sel, setSel] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState<string | null>(null);

  const { rows, groups, couriers, counts } = data;
  const toggle = (n: string) => setSel((s) => { const x = new Set(s); x.has(n) ? x.delete(n) : x.add(n); return x; });
  const selected = rows.filter((r) => sel.has(r.number));
  const canBook = selected.filter((r) => !r.kaOrderId);
  const canFetch = selected.filter((r) => r.kaOrderId && !r.awb);
  const canPrint = selected.filter((r) => r.awb);

  function go(next: Record<string, string | undefined>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) v ? sp.set(k, v) : sp.delete(k);
    router.push(sp.toString() ? `${pathname}?${sp}` : pathname, { scroll: false });
  }

  // Partial failure is reported per order — never summarised into "berhasil". 8 booked / 2 failed
  // must read as exactly that: the seller has to know WHICH two.
  const report = (r: { done: number; failed: { number: string; error: string }[]; awaitingResi: string[] }, verb: string) => {
    if (r.done) toast.success(`${r.done} pesanan ${verb}.`);
    if (r.awaitingResi.length)
      toast.info(`${r.awaitingResi.length} menunggu resi`, {
        description: "Kurir belum menerbitkan nomor resi. Klik “Ambil resi” lagi nanti — label baru bisa dicetak setelah resi terbit.",
        duration: 8000,
      });
    for (const f of r.failed.slice(0, 4)) toast.error(`${f.number}: ${f.error}`, { duration: 9000 });
    router.refresh();
  };

  const run = async (label: string, fn: () => Promise<{ done: number; failed: { number: string; error: string }[]; awaitingResi: string[] }>, verb: string) => {
    setBusy(label);
    try { report(await fn(), verb); } finally { setBusy(null); }
  };

  // Print: fetch each label's HTML from the server (buildLabelHtml needs order data), concatenate and
  // hand the whole thing to one print dialog. Each label carries its own @page 100mm×150mm, so a
  // thermal printer cuts them apart on its own.
  const printSelected = async () => {
    if (!canPrint.length) return;
    setBusy("print");
    try {
      const res = await fetch("/api/admin/labels", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numbers: canPrint.map((r) => r.number) }),
      });
      const { html, error } = await res.json();
      if (!html) { toast.error(error ?? "Gagal menyiapkan label."); return; }
      const w = window.open("", "_blank", "width=420,height=640");
      if (!w) { toast.error("Popup diblokir browser — izinkan popup untuk mencetak."); return; }
      w.document.write(html); w.document.close(); w.focus(); w.print();
      // "Ditandai dicetak", not "berhasil dicetak": we opened the dialog, we cannot see the printer.
      await markLabelsPrinted(canPrint.map((r) => r.number));
      toast.success(`${canPrint.length} label ditandai dicetak.`);
      router.refresh();
    } finally { setBusy(null); }
  };

  const Filter = ({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) => (
    <Button size="sm" variant={active ? "secondary" : "ghost"} className="h-7 shrink-0" onClick={onClick}>{label}</Button>
  );

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <PageHeader title="Pengiriman Massal" desc="Booking, ambil resi, dan cetak label thermal untuk banyak pesanan sekaligus." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { l: "Perlu dikirim", v: counts.total },
          { l: "Sudah dibooking", v: counts.booked },
          { l: "Resi terbit", v: counts.withResi },
          { l: "Sudah dicetak", v: counts.printed },
        ].map((s) => (
          <Card key={s.l} className="p-4">
            <p className="text-xs text-muted-foreground">{s.l}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{s.v}</p>
          </Card>
        ))}
      </div>

      <Card className="p-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-medium text-muted-foreground">Layanan</span>
            <Filter label="Semua" active={!filters.group} onClick={() => go({ group: undefined })} />
            {groups.map((g) => (
              <Filter key={g.key} label={`${GROUP_LABEL[g.key] ?? g.key} (${g.count})`} active={filters.group === g.key} onClick={() => go({ group: g.key })} />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-medium text-muted-foreground">Jasa kirim</span>
            <Filter label="Semua" active={!filters.courier} onClick={() => go({ kurir: undefined })} />
            {couriers.map((c) => (
              <Filter key={c.code} label={`${c.code} (${c.count})`} active={filters.courier === c.code} onClick={() => go({ kurir: c.code })} />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-medium text-muted-foreground">Status cetak</span>
            <Filter label="Semua" active={!filters.printed} onClick={() => go({ cetak: undefined })} />
            <Filter label="Belum dicetak" active={filters.printed === "no"} onClick={() => go({ cetak: "no" })} />
            <Filter label="Sudah dicetak" active={filters.printed === "yes"} onClick={() => go({ cetak: "yes" })} />
            <span className="mx-2 hidden h-4 w-px bg-border sm:block" />
            <span className="mr-1 text-xs font-medium text-muted-foreground">Isi</span>
            <Filter label="Semua" active={!filters.bundle} onClick={() => go({ isi: undefined })} />
            <Filter label="Bijian" active={filters.bundle === "no"} onClick={() => go({ isi: "no" })} />
            <Filter label="Bundling" active={filters.bundle === "yes"} onClick={() => go({ isi: "yes" })} />
          </div>
        </div>
      </Card>

      {/* Same trap as the Keuangan card: <Card> is `flex flex-col`, so `items-center` on it centres
          the row horizontally instead of aligning it. The row lives INSIDE. */}
      {canWrite && (
        <Card className="p-3">
          <div className="flex flex-wrap items-center gap-2">
          <Checkbox
            checked={sel.size > 0 && sel.size === rows.length}
            onCheckedChange={() => setSel(sel.size === rows.length ? new Set() : new Set(rows.map((r) => r.number)))}
            aria-label="Pilih semua"
          />
          <span className="text-sm text-muted-foreground">{sel.size} dipilih</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" disabled={!canBook.length || !!busy} onClick={() => run("book", () => bulkGenerateResi(canBook.map((r) => r.number)), "dibooking")}>
              {busy === "book" ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : <PackageCheck className="mr-1 size-3.5" />}
              Generate resi ({canBook.length})
            </Button>
            <Button size="sm" variant="outline" disabled={!canFetch.length || !!busy} onClick={() => run("fetch", () => bulkFetchResi(canFetch.map((r) => r.number)), "diperbarui")}>
              {busy === "fetch" ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : <RefreshCw className="mr-1 size-3.5" />}
              Ambil resi ({canFetch.length})
            </Button>
            <Button size="sm" variant="outline" disabled={!canPrint.length || !!busy} onClick={printSelected}>
              {busy === "print" ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : <Printer className="mr-1 size-3.5" />}
              Cetak resi ({canPrint.length})
            </Button>
          </div>
          </div>
        </Card>
      )}

      {/* The one thing a seller must understand here, said once, plainly. */}
      {/* The inline <span>s were becoming flex ITEMS of this row and shattering the sentence across
          lines. Only the icon and the text are flex children now; the emphasis lives inside the text. */}
      <div className="flex items-start gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <p>
          Resi tidak terbit seketika: setelah <b className="font-medium text-foreground">Generate resi</b>, kurir perlu
          menerima permintaan jemput dulu. Klik <b className="font-medium text-foreground">Ambil resi</b> untuk mengeceknya —
          label hanya bisa dicetak setelah nomor resi asli terbit.
        </p>
      </div>

      <Card className="overflow-hidden p-0">
        <ResponsiveTable
          table={
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-10 pl-4" />
                  <TableHead>Pesanan</TableHead>
                  <TableHead>Pembeli</TableHead>
                  <TableHead>Layanan</TableHead>
                  <TableHead>Isi</TableHead>
                  <TableHead>Resi</TableHead>
                  <TableHead>Cetak</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={8} className="h-32 text-center text-sm text-muted-foreground">
                      Tidak ada pesanan yang cocok dengan filter ini.
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((r) => (
                  <TableRow key={r.number}>
                    <TableCell className="pl-4"><Checkbox checked={sel.has(r.number)} onCheckedChange={() => toggle(r.number)} aria-label={`Pilih ${r.number}`} /></TableCell>
                    <TableCell className="font-mono text-sm">{r.number}</TableCell>
                    <TableCell className="text-sm">{r.buyer}<div className="text-xs text-muted-foreground">{r.city}</div></TableCell>
                    <TableCell className="text-sm"><ServiceCell r={r} /></TableCell>
                    <TableCell><IsiCell r={r} /></TableCell>
                    <TableCell><ResiCell r={r} /></TableCell>
                    <TableCell><CetakCell r={r} /></TableCell>
                    <TableCell className="text-right tabular-nums">{IDR(r.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          }
          cards={
            rows.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">Tidak ada pesanan yang cocok dengan filter ini.</div>
            ) : (
              rows.map((r) => (
                <DataCard
                  key={r.number}
                  lead={<Checkbox checked={sel.has(r.number)} onCheckedChange={() => toggle(r.number)} aria-label={`Pilih ${r.number}`} />}
                  title={<span className="truncate font-mono text-sm font-medium">{r.number}</span>}
                  badge={<ResiCell r={r} />}
                >
                  <DataRow label="Pembeli">{r.buyer} <span className="text-muted-foreground">· {r.city}</span></DataRow>
                  <DataRow label="Layanan"><ServiceCell r={r} /></DataRow>
                  <DataRow label="Isi"><IsiCell r={r} /></DataRow>
                  <DataRow label="Cetak"><CetakCell r={r} /></DataRow>
                  <DataRow label="Total" strong>{IDR(r.total)}</DataRow>
                </DataCard>
              ))
            )
          }
        />
      </Card>
    </div>
  );
}

function ServiceCell({ r }: { r: BulkOrderRow }) {
  if (!r.courier) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div className="leading-tight">
      <div className="text-sm">{r.serviceName ?? r.courier}</div>
      {r.group && <div className="text-xs text-muted-foreground">{GROUP_LABEL[r.group] ?? r.group}</div>}
    </div>
  );
}
const IsiCell = ({ r }: { r: BulkOrderRow }) =>
  r.isBundle ? <Badge variant="secondary">Bundling · {r.itemCount}</Badge> : <Badge variant="outline" className="text-muted-foreground">Bijian</Badge>;

function ResiCell({ r }: { r: BulkOrderRow }) {
  if (r.awb) return <Badge className="bg-emerald-100 font-mono text-emerald-800">{r.awb}</Badge>;
  if (r.kaOrderId) return <Badge className="bg-amber-100 text-amber-800">Menunggu resi</Badge>;
  return <Badge variant="outline" className="text-muted-foreground">Belum dibooking</Badge>;
}
const CetakCell = ({ r }: { r: BulkOrderRow }) =>
  r.printedAt ? <Badge variant="secondary">Sudah</Badge> : <Badge variant="outline" className="text-muted-foreground">Belum</Badge>;
