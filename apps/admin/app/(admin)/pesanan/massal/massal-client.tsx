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
//   Ambil resi    → ONE tracking pull per click. It is NOT a poll — this said "poll until the courier
//                   issues the waybill", which promises a loop that does not exist: click once, get one
//                   answer, and if the courier hasn't issued the AWB yet nothing happens and the
//                   merchant must click again. The 15-min cron is the only actual loop.
//   Cetak         → 100×150mm thermal labels, one @page each (buildLabelHtml)
// The buttons are gated on the row's real state, never on hope: you cannot print what has no AWB,
// because buildLabelHtml refuses — correctly — to invent one.

const GROUP_LABEL: Record<string, string> = {
  one_day: "1 Hari", next_day: "Next Day", regular: "Reguler", economy: "Ekonomi", cargo: "Cargo",
};

// ⚠️ DECLARED OUTSIDE the screen, not inside it. A component defined during render is a NEW component
// type on every parent render, so React unmounts and remounts its whole subtree — state lost, focus
// dropped mid-typing. `AGENTS.md` names this class explicitly, and this is the bulk-shipping screen:
// the filters sit above a table the merchant selects rows in.
function Filter({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <Button size="sm" variant={active ? "secondary" : "ghost"} className="h-7 shrink-0" onClick={onClick}>
      {label}
    </Button>
  );
}

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

  // `guessedDestination` is optional because only `bulkGenerateResi` books anything — the fetch-resi
  // and print runs reuse this reporter and have nothing to guess.
  type BulkReport = {
    done: number;
    failed: { number: string; error: string }[];
    /** Selected but never attempted — the run's own 50-order ceiling. Work still owed. */
    skipped: string[];
    awaitingResi: string[];
    guessedDestination?: { number: string; district: string }[];
  };

  // Partial failure is reported per order — never summarised into "berhasil". 8 booked / 2 failed
  // must read as exactly that: the seller has to know WHICH two.
  const report = (r: BulkReport, verb: string) => {
    if (r.done) toast.success(`${r.done} pesanan ${verb}.`);
    // ⚠️ SAY WHAT WAS NOT ATTEMPTED. One run handles at most 50 orders while this list holds up to
    // 200 and the button posts the whole selection, so selecting 150 used to read "50 pesanan
    // dibooking" with nothing anywhere naming the other 100 — parcels that quietly never ship. The
    // remainder stays selected, so pressing the button again continues the run.
    if (r.skipped.length)
      toast.warning(`${r.skipped.length} pesanan belum diproses`, {
        description:
          "Satu kali jalan menangani maksimal 50 pesanan supaya kurir tidak menolak permintaan di tengah jalan. " +
          "Sisanya masih dipilih — tekan tombolnya lagi untuk melanjutkan.",
        duration: 12000,
      });
    if (r.awaitingResi.length)
      toast.info(`${r.awaitingResi.length} menunggu resi`, {
        // ⚠️ Say that it arrives ON ITS OWN. The poller (`cron-tracking`, every 15 min) fills
        // `orders.awb` for every booked order — so "klik lagi nanti" described the feature as manual
        // when the automatic path was already the normal one, and left the merchant watching a queue.
        // "Ambil resi" is the shortcut for someone who does not want to wait, not the mechanism.
        description:
          "Kurir belum menerbitkan nomor resi. Resi akan muncul sendiri begitu kurir menerima pesanan — " +
          "biasanya beberapa menit. Tombol “Ambil resi” hanya mempercepat; label bisa dicetak setelah resi terbit.",
        duration: 8000,
      });
    // A guessed destination is NOT a failure — the parcel is booked — so it cannot ride in `failed`,
    // and it must not be swallowed by the "N pesanan dibooking" success line either. This is the one
    // place a bulk run can tell the merchant that some of those bookings went to a district nobody
    // confirmed, while the courier has not collected yet.
    for (const g of (r.guessedDestination ?? []).slice(0, 4))
      toast.warning(`${g.number}: tujuan ditebak — “${g.district}”`, {
        description: "Pesanan ini tidak menyimpan kecamatan tujuan, jadi kurir dibooking ke hasil pencocokan nama kota. Periksa sebelum kurir menjemput.",
        duration: 20000,
      });
    for (const f of r.failed.slice(0, 4)) toast.error(`${f.number}: ${f.error}`, { duration: 9000 });
    router.refresh();
  };

  const run = async (label: string, fn: () => Promise<BulkReport>, verb: string) => {
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
      // `skipped` MUST be read. The server prints only orders with a real AWB and names the rest here;
      // stamping the whole selection as printed would hide those orders behind the "Belum dicetak"
      // filter — a parcel that silently never ships. Only what actually got a label gets stamped.
      const { html, error, skipped } = (await res.json()) as { html?: string | null; error?: string; skipped?: string[] };
      const missed = new Set(skipped ?? []);
      const printedNumbers = canPrint.map((r) => r.number).filter((n) => !missed.has(n));

      if (!html || !printedNumbers.length) {
        // Nothing was printable: no print window, no stamp, and say exactly why.
        toast.error(
          error ?? `Tidak ada label yang bisa dicetak dari ${canPrint.length} pesanan terpilih.`,
          { description: "Resi belum terbit untuk pesanan ini. Klik “Ambil resi” dulu — label baru bisa dicetak setelah nomor resi asli terbit.", duration: 9000 },
        );
        return;
      }

      const w = window.open("", "_blank", "width=420,height=640");
      if (!w) { toast.error("Popup diblokir browser — izinkan popup untuk mencetak."); return; }
      w.document.write(html); w.document.close(); w.focus(); w.print();
      // "Ditandai dicetak", not "berhasil dicetak": we opened the dialog, we cannot see the printer.
      //
      // ⚠️ Report what we WROTE, never what we asked to write. `markLabelsPrinted` returns the row
      // count its UPDATE actually matched (`.returning()`) — a number that matched nothing, e.g. an
      // order belonging to another store (RLS filters it out, no error) or one since deleted, is NOT
      // stamped. The action was fixed to stop lying about that; toasting `printedNumbers.length` here
      // told the same lie one layer up, and those orders stay behind the "Belum dicetak" filter until
      // the merchant finds out at the drop-off point.
      const { done } = await markLabelsPrinted(printedNumbers);
      if (done < printedNumbers.length)
        toast.warning(`${done} dari ${printedNumbers.length} label ditandai dicetak.`, {
          description: `${printedNumbers.length - done} pesanan tidak bisa ditandai — nomornya tidak ditemukan di toko ini. Labelnya ikut tercetak, tapi statusnya masih “Belum dicetak”.`,
          duration: 12000,
        });
      else toast.success(`${done} label ditandai dicetak.`);
      if (missed.size)
        toast.warning(`${missed.size} pesanan dilewati — resi belum terbit`, {
          description: `Tidak ikut tercetak dan TIDAK ditandai dicetak: ${[...missed].slice(0, 5).join(", ")}${missed.size > 5 ? `, +${missed.size - 5} lagi` : ""}. Klik “Ambil resi” dulu, lalu cetak ulang pesanan tersebut.`,
          duration: 12000,
        });
      router.refresh();
    } finally { setBusy(null); }
  };

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
