"use client";

// Seller → Affiliate (ADR 0022). Presentation only: every write goes through the same server actions
// (lib/actions/affiliates.ts), which carry the capability check. Phones get labelled cards instead of
// the tables (which clipped the actions off-screen); reject / deactivate / mark-paid ask first.

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Copy, Download, MessageCircle, Pencil, Plus, Settings, UserPlus, Users } from "lucide-react";

import { PageHeader } from "@/components/admin/page-header";
import { ToggleRow } from "@/components/admin/pengaturan/toggle-row";
import { useCan } from "@/components/admin/permissions";
import { IDR, num, waLink } from "@tokophi/lib/format";
import { formatRateBps } from "@tokophi/lib/affiliate";
import type { AffiliateProgram, AffiliateRow } from "@/lib/data/affiliates";
import { COMMISSION_STATE as STATE } from "@/lib/commission-state";
import {
  createAffiliate,
  exportAffiliateCommissionsCsv,
  inviteAffiliateToAccount,
  markCommissionPaid,
  saveAffiliateSettings,
  setAffiliateStatus,
  setProductAffiliateRate,
  updateAffiliate,
} from "@/lib/actions/affiliates";

import { Badge } from "@tokophi/ui/badge";
import { Button } from "@tokophi/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@tokophi/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@tokophi/ui/dialog";
import { Input } from "@tokophi/ui/input";
import { Label } from "@tokophi/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@tokophi/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@tokophi/ui/tabs";

type Commission = AffiliateProgram["commissions"][number];

const AFF_STATUS: Record<AffiliateRow["status"], { label: string; className: string }> = {
  menunggu: { label: "Menunggu persetujuan", className: "bg-amber-500/10 text-amber-800 dark:text-amber-400" },
  aktif: { label: "Aktif", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  ditolak: { label: "Ditolak", className: "bg-muted text-muted-foreground" },
  nonaktif: { label: "Nonaktif", className: "bg-muted text-muted-foreground" },
};
// Applicants first (they need a decision), then the ones earning, then the closed ones.
const STATUS_ORDER: Record<AffiliateRow["status"], number> = { menunggu: 0, aktif: 1, nonaktif: 2, ditolak: 3 };
const date = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "—";

export function AffiliateClient({ program }: { program: AffiliateProgram }) {
  const { settings, affiliates, commissions } = program;
  const waiting = affiliates.filter((a) => a.status === "menunggu").length;
  const active = affiliates.filter((a) => a.status === "aktif").length;
  const ready = commissions.filter((c) => c.state === "siap");
  const owed = ready.reduce((s, c) => s + c.commissionIdr, 0);
  // Controlled, chosen ONCE: a `defaultValue` that changes after a router.refresh (an applicant approved)
  // makes Base UI warn about an uncontrolled Tabs changing its default.
  const [tab, setTab] = React.useState<string>(() => (waiting ? "affiliate" : "komisi"));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Affiliate" desc="Reseller & kreator mempromosikan toko Anda dengan kode atau link. Komisi dihitung otomatis; Anda mentransfernya sendiri lalu menandainya dibayar.">
        <AddAffiliateDialog />
      </PageHeader>

      {!settings.enabled && (
        <Banner tone="amber" title="Program affiliate belum aktif" action={<Button variant="outline" onClick={() => setTab("pengaturan")}><Settings />Buka pengaturan</Button>}>
          Kode affiliate belum dihitung di checkout dan halaman pendaftaran toko belum tampil.
        </Banner>
      )}
      {waiting > 0 && (
        <Banner tone="indigo" title={`${num(waiting)} pendaftar menunggu persetujuan Anda`} action={<Button onClick={() => setTab("affiliate")}>Tinjau pendaftar</Button>}>
          Mereka baru bisa membagikan kode dan link setelah Anda setujui.
        </Banner>
      )}

      <Card className="py-0">
        <CardContent className="grid grid-cols-3 divide-x px-0">
          <Stat label="Affiliate aktif" value={num(active)} />
          <Stat label="Menunggu" value={num(waiting)} />
          <Stat label="Siap dibayar" value={IDR(owed)} hint={ready.length ? `${num(ready.length)} komisi` : undefined} />
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
        <TabsList>
          <TabsTrigger value="komisi">Komisi</TabsTrigger>
          <TabsTrigger value="affiliate">Affiliate{waiting ? ` (${waiting} baru)` : ""}</TabsTrigger>
          <TabsTrigger value="pengaturan">Pengaturan</TabsTrigger>
        </TabsList>
        <TabsContent value="komisi" className="mt-4 grid gap-4">
          <ExportCommissions range={program.exportRange} />
          <CommissionList program={program} />
        </TabsContent>
        <TabsContent value="affiliate" className="mt-4">
          <AffiliateList program={program} />
        </TabsContent>
        <TabsContent value="pengaturan" className="mt-4 grid gap-6">
          <SettingsCard program={program} />
          <ProductRatesCard program={program} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Banner({ tone, title, action, children }: { tone: "amber" | "indigo"; title: string; action: React.ReactNode; children: React.ReactNode }) {
  const cls = tone === "amber" ? "border-amber-500/40 bg-amber-500/5" : "border-primary/30 bg-primary/5";
  return (
    <div role="status" className={`flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between ${cls}`}>
      <div className="min-w-0 text-sm">
        <p className="font-semibold">{title}</p>
        <p className="mt-0.5 text-muted-foreground">{children}</p>
      </div>
      <div className="shrink-0 [&_button]:h-10 [&_button]:w-full sm:[&_button]:h-8 sm:[&_button]:w-auto">{action}</div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 px-3 py-3 sm:px-5 sm:py-4">
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-base font-semibold tabular-nums sm:text-xl">{value}</p>
      {hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function useAction() {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(success);
        router.refresh();
      } else toast.error(r.error ?? "Gagal menyimpan.");
    });
  return { pending, run };
}

/** A button that asks before it acts — for decisions that are not undone with one click. */
function ConfirmAction(props: {
  label: string;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  disabled?: boolean;
  primary?: boolean;
  className?: string;
  onConfirm: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" variant={props.primary ? "default" : "outline"} disabled={props.disabled} className={props.className}>
            {props.label}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          <DialogDescription>{props.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline">Batal</Button>} />
          <Button
            variant={props.destructive ? "destructive" : "default"}
            onClick={() => {
              setOpen(false);
              props.onConfirm();
            }}
          >
            {props.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmptyState({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-sm">
        <Users className="size-6 text-muted-foreground" aria-hidden />
        <p className="font-semibold">{title}</p>
        <div className="max-w-md text-muted-foreground">{children}</div>
      </CardContent>
    </Card>
  );
}

function StateBadge({ c }: { c: Commission }) {
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <Badge className={STATE[c.state].className}>{STATE[c.state].label}</Badge>
      {c.state === "ditahan" && <span className="text-xs text-muted-foreground">bisa dibayar {date(c.eligibleAt)}</span>}
      {c.state === "dibayar" && <span className="text-xs text-muted-foreground">{date(c.paidAt)}</span>}
    </span>
  );
}

function MarkPaid({ c, pending, onConfirm, className }: { c: Commission; pending: boolean; onConfirm: () => void; className?: string }) {
  return (
    <ConfirmAction
      primary
      label="Tandai dibayar"
      title="Tandai komisi dibayar?"
      description={
        <>
          Komisi <b>{IDR(c.commissionIdr)}</b> untuk <b>{c.affiliateName}</b> (pesanan {c.orderNumber}). Lakukan ini setelah Anda
          mentransfernya. Status dibayar tidak bisa dibatalkan dari layar ini.
        </>
      }
      confirmLabel="Ya, sudah dibayar"
      disabled={pending}
      className={className}
      onConfirm={onConfirm}
    />
  );
}

/** F-A11: the CSV is built on the server (capability + tenant there); this only hands the text to the browser as a file. */
function ExportCommissions({ range }: { range: AffiliateProgram["exportRange"] }) {
  const canWrite = useCan("affiliates:write");
  const [from, setFrom] = React.useState(range.from);
  const [to, setTo] = React.useState(range.to);
  const [pending, start] = React.useTransition();
  if (!canWrite) return null;
  const download = () =>
    start(async () => {
      const r = await exportAffiliateCommissionsCsv({ from, to });
      if (!r.ok) return void toast.error(r.error);
      const url = URL.createObjectURL(new Blob([r.csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = r.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(r.rows ? `${num(r.rows)} komisi diunduh.` : "Tidak ada komisi pada rentang ini — file berisi judul kolom saja.");
    });
  return (
    <Card className="gap-3 py-4">
      <CardContent className="grid gap-3 px-4 sm:flex sm:flex-wrap sm:items-end">
        <div className="grid grid-cols-2 gap-3 sm:flex sm:gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="aff-exp-from">Dari tanggal</Label>
            <Input id="aff-exp-from" type="date" className="h-10 sm:h-9" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="aff-exp-to">Sampai tanggal</Label>
            <Input id="aff-exp-to" type="date" className="h-10 sm:h-9" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        <Button variant="outline" className="h-10 sm:h-9" disabled={pending || !from || !to} onClick={download}>
          <Download />
          {pending ? "Menyiapkan…" : "Unduh CSV komisi"}
        </Button>
        <p className="text-xs text-muted-foreground sm:basis-full">
          Semua komisi toko ini menurut tanggal pesanan (WIB). Pemotongan pajak atas komisi (PPh) menjadi tanggung jawab toko.
        </p>
      </CardContent>
    </Card>
  );
}

function CommissionList({ program }: { program: AffiliateProgram }) {
  const canWrite = useCan("affiliates:write");
  const { pending, run } = useAction();
  if (!program.commissions.length)
    return (
      <EmptyState title="Belum ada komisi">
        Komisi tercatat otomatis begitu pembeli memakai kode atau link affiliate yang aktif.
        {program.affiliates.length === 0 && " Mulai dengan menyetujui pendaftar atau menambah affiliate sendiri."}
      </EmptyState>
    );
  // Payable first — that is the job on this tab — otherwise the newest first, as loaded.
  const rows = [...program.commissions].sort((a, b) => Number(b.state === "siap") - Number(a.state === "siap"));
  const pay = (c: Commission) => run(() => markCommissionPaid(c.id), "Komisi ditandai dibayar.");
  return (
    <>
      <ul className="grid gap-3 md:hidden" aria-label="Komisi affiliate">
        {rows.map((c) => (
          <li key={c.id}>
            <Card className="gap-3 py-4">
              <CardContent className="grid gap-3 px-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{c.orderNumber}</p>
                    <p className="text-xs text-muted-foreground">{date(c.createdAt)} · {c.source === "kode" ? "kode diketik" : "lewat link"}</p>
                  </div>
                  <StateBadge c={c} />
                </div>
                <p className="text-sm">
                  {c.affiliateName} <span className="font-mono text-xs text-muted-foreground">{c.affiliateCode}</span>
                </p>
                <dl className="grid grid-cols-2 gap-2 rounded-lg bg-muted/50 p-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Nilai produk</dt>
                    <dd className="tabular-nums">{IDR(c.baseIdr)}</dd>
                  </div>
                  <div className="text-right">
                    <dt className="text-xs text-muted-foreground">Komisi {c.rateNote ? `(${c.rateNote})` : ""}</dt>
                    <dd className="font-semibold tabular-nums">{IDR(c.commissionIdr)}</dd>
                  </div>
                </dl>
                {canWrite && c.state === "siap" && <MarkPaid c={c} pending={pending} onConfirm={() => pay(c)} className="h-10 w-full" />}
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
      <Card className="hidden py-0 md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Pesanan</TableHead>
              <TableHead>Affiliate</TableHead>
              <TableHead className="text-right">Nilai produk</TableHead>
              <TableHead className="text-right">Komisi</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="pr-4"><span className="sr-only">Aksi</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="pl-4">
                  <div className="font-medium">{c.orderNumber}</div>
                  <div className="text-xs text-muted-foreground">{date(c.createdAt)} · {c.source === "kode" ? "kode diketik" : "lewat link"}</div>
                </TableCell>
                <TableCell>
                  <div>{c.affiliateName}</div>
                  <div className="font-mono text-xs text-muted-foreground">{c.affiliateCode}</div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{IDR(c.baseIdr)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  <div className="font-medium">{IDR(c.commissionIdr)}</div>
                  <div className="text-xs text-muted-foreground">{c.rateNote}</div>
                </TableCell>
                <TableCell>
                  <StateBadge c={c} />
                </TableCell>
                <TableCell className="pr-4 text-right">
                  {canWrite && c.state === "siap" && <MarkPaid c={c} pending={pending} onConfirm={() => pay(c)} />}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}

/** Approve / reject / deactivate / re-approve — the same rules for the phone card and the table row. */
function StatusActions({ a, pending, run, wide }: { a: AffiliateRow; pending: boolean; run: ReturnType<typeof useAction>["run"]; wide?: boolean }) {
  const cls = wide ? "h-10 flex-1" : undefined;
  const approve = (msg: string) => run(() => setAffiliateStatus(a.id, "aktif"), msg);
  return (
    <>
      {(a.status === "menunggu" || a.status === "nonaktif") && (
        <Button size="sm" className={cls} disabled={pending} onClick={() => approve(a.status === "menunggu" ? "Affiliate disetujui." : "Affiliate diaktifkan lagi.")}>
          <Check />
          {a.status === "menunggu" ? "Setujui" : "Aktifkan lagi"}
        </Button>
      )}
      {a.status === "menunggu" && (
        <ConfirmAction
          label="Tolak"
          title={`Tolak pendaftaran ${a.name}?`}
          description="Kode dan link-nya tidak akan menghasilkan komisi. Anda masih bisa menyetujuinya nanti dari daftar ini."
          confirmLabel="Tolak pendaftaran"
          destructive
          disabled={pending}
          className={cls}
          onConfirm={() => run(() => setAffiliateStatus(a.id, "ditolak"), "Pendaftaran ditolak.")}
        />
      )}
      {a.status === "aktif" && (
        <ConfirmAction
          label="Nonaktifkan"
          title={`Nonaktifkan ${a.name}?`}
          description={
            <>
              Pesanan baru dengan kode <b className="font-mono">{a.code}</b> tidak lagi menghasilkan komisi. Komisi yang sudah tercatat tetap ada
              dan tetap bisa Anda bayar. Bisa diaktifkan lagi kapan saja.
            </>
          }
          confirmLabel="Nonaktifkan"
          destructive
          disabled={pending}
          className={cls}
          onConfirm={() => run(() => setAffiliateStatus(a.id, "nonaktif"), "Affiliate dinonaktifkan.")}
        />
      )}
      {a.status === "ditolak" && (
        <Button size="sm" variant="outline" className={cls} disabled={pending} onClick={() => approve("Affiliate disetujui.")}>
          Setujui
        </Button>
      )}
    </>
  );
}

function AffiliateList({ program }: { program: AffiliateProgram }) {
  const canWrite = useCan("affiliates:write");
  const { pending, run } = useAction();
  const joinUrl = `https://${program.storeHost}/affiliate`;
  const copy = (text: string, what: string) =>
    navigator.clipboard.writeText(text).then(
      () => toast.success(`${what} disalin.`),
      () => window.prompt(`Salin ${what.toLowerCase()}:`, text),
    );
  if (!program.affiliates.length)
    return (
      <EmptyState title="Belum ada affiliate">
        <p>
          {program.settings.enabled
            ? "Bagikan halaman pendaftaran toko Anda ke reseller atau kreator. Pendaftar muncul di sini untuk Anda setujui."
            : "Aktifkan program di tab Pengaturan agar halaman pendaftaran tampil di toko."}
        </p>
        {program.settings.enabled && (
          <div className="mt-3 flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
            <code className="rounded-md bg-muted px-2 py-1 text-xs text-foreground">{joinUrl}</code>
            <Button size="sm" variant="outline" onClick={() => copy(joinUrl, "Link pendaftaran")}>
              <Copy />
              Salin link pendaftaran
            </Button>
          </div>
        )}
        <p className="mt-3">Atau tambahkan affiliate sendiri dengan tombol <b>Tambah affiliate</b>.</p>
      </EmptyState>
    );
  // The link is minted server-side; the clipboard can be missing (plain-http origin) or refuse after
  // the await, so fall back to a prompt the seller can copy from.
  const invite = async (a: AffiliateRow) => {
    const r = await inviteAffiliateToAccount(a.id);
    if (!r.ok) return void toast.error(r.error);
    try {
      await navigator.clipboard.writeText(r.url);
      toast.success(`Link undangan untuk ${a.name} disalin (berlaku 7 hari, sekali pakai). Kirim hanya ke ${a.name}.`);
    } catch {
      window.prompt(`Link undangan ${a.name} — kirim hanya ke ${a.name} (7 hari, sekali pakai):`, r.url);
    }
  };
  const rows = [...program.affiliates].sort((x, y) => STATUS_ORDER[x.status] - STATUS_ORDER[y.status]);
  const linkOf = (a: AffiliateRow) => `https://${program.storeHost}/?ref=${a.code}`;
  const waHref = (a: AffiliateRow) => waLink(a.phone, `Halo ${a.name}, kode affiliate Anda: ${a.code}\nLink: ${linkOf(a)}`);
  const canInvite = (a: AffiliateRow) => program.invites && a.status === "aktif" && !a.linked;

  return (
    <>
      <ul className="grid gap-3 md:hidden" aria-label="Daftar affiliate">
        {rows.map((a) => (
          <li key={a.id}>
            <Card className={`gap-3 py-4 ${a.status === "menunggu" ? "ring-amber-500/40" : ""}`}>
              <CardContent className="grid gap-3 px-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{a.name}</p>
                    <p className="wrap-anywhere text-xs text-muted-foreground">{a.phone}{a.email ? ` · ${a.email}` : ""}</p>
                  </div>
                  <Badge className={AFF_STATUS[a.status].className}>{AFF_STATUS[a.status].label}</Badge>
                </div>
                {a.note && <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs italic text-muted-foreground">“{a.note}”</p>}
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>
                    Kode <span className="font-mono font-medium">{a.code}</span>
                    {a.linked && <span className="block text-xs text-muted-foreground">Terhubung ke akun affiliate</span>}
                  </span>
                  {a.status === "aktif" && (
                    <Button size="sm" variant="outline" className="h-10" onClick={() => copy(linkOf(a), "Link")}>
                      <Copy />
                      Salin link
                    </Button>
                  )}
                </div>
                {a.status !== "menunggu" && (
                  <dl className="grid grid-cols-3 gap-2 rounded-lg bg-muted/50 p-3 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">Pesanan</dt>
                      <dd className="tabular-nums">{num(a.orders)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Siap dibayar</dt>
                      <dd className="font-semibold tabular-nums">{IDR(a.owedIdr)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Ditahan</dt>
                      <dd className="tabular-nums">{IDR(a.heldIdr)}</dd>
                    </div>
                  </dl>
                )}
                {a.bank && <p className="text-xs text-muted-foreground">Rekening: {a.bank}</p>}
                <div className="flex flex-wrap gap-2">
                  {canWrite && <StatusActions a={a} pending={pending} run={run} wide />}
                  {canWrite && a.bankParts && <EditAffiliateDialog a={a} wide />}
                  {!a.contactMasked && (
                    <Button size="sm" variant="outline" className="h-10 flex-1" nativeButton={false} render={<a href={waHref(a)} target="_blank" rel="noreferrer" />}>
                      <MessageCircle />
                      WhatsApp
                    </Button>
                  )}
                  {canInvite(a) && (
                    <Button size="sm" variant="outline" className="h-10 flex-1" onClick={() => invite(a)}>
                      <UserPlus />
                      Undang ke akun
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
      <Card className="hidden py-0 md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Affiliate</TableHead>
              <TableHead>Kode</TableHead>
              <TableHead className="text-right">Pesanan</TableHead>
              <TableHead className="text-right">Siap dibayar</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="pr-4"><span className="sr-only">Aksi</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((a) => (
              <TableRow key={a.id} className={a.status === "menunggu" ? "bg-amber-500/5" : undefined}>
                <TableCell className="pl-4">
                  <div className="font-medium">{a.name}</div>
                  <div className="text-xs text-muted-foreground">{a.phone}{a.email ? ` · ${a.email}` : ""}</div>
                  {a.bank && <div className="text-xs text-muted-foreground">{a.bank}</div>}
                  {a.note && <div className="mt-1 max-w-xs whitespace-normal text-xs italic text-muted-foreground">“{a.note}”</div>}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <span className="font-mono text-sm">{a.code}</span>
                    {a.status === "aktif" && (
                      <Button size="icon-sm" variant="ghost" aria-label={`Salin link ${a.code}`} title="Salin link affiliate" onClick={() => copy(linkOf(a), "Link")}>
                        <Copy />
                      </Button>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{num(a.orders)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {IDR(a.owedIdr)}
                  {a.heldIdr > 0 && <div className="text-xs text-muted-foreground">+{IDR(a.heldIdr)} ditahan</div>}
                </TableCell>
                <TableCell>
                  <Badge className={AFF_STATUS[a.status].className}>{AFF_STATUS[a.status].label}</Badge>
                  {a.linked && <div className="mt-1 text-xs text-muted-foreground">Terhubung ke akun affiliate</div>}
                </TableCell>
                <TableCell className="pr-4 text-right">
                  <div className="flex justify-end gap-1">
                    {!a.contactMasked && (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        nativeButton={false}
                        aria-label={`WhatsApp ${a.name}`}
                        title={`WhatsApp ${a.name}`}
                        render={<a href={waHref(a)} target="_blank" rel="noreferrer" />}
                      >
                        <MessageCircle />
                      </Button>
                    )}
                    {canInvite(a) && (
                      <Button size="icon-sm" variant="ghost" aria-label={`Undang ${a.name} ke akun affiliate`} title="Undang ke akun affiliate" onClick={() => invite(a)}>
                        <UserPlus />
                      </Button>
                    )}
                    {canWrite && a.bankParts && <EditAffiliateDialog a={a} />}
                    {canWrite && <StatusActions a={a} pending={pending} run={run} />}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}

function SettingsCard({ program }: { program: AffiliateProgram }) {
  const canWrite = useCan("affiliates:write");
  const { pending, run } = useAction();
  const [enabled, setEnabled] = React.useState(program.settings.enabled);
  const [rate, setRate] = React.useState(String(program.settings.rateBps / 100));
  const [hold, setHold] = React.useState(String(program.settings.holdDays));
  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>Program affiliate</CardTitle>
        <CardDescription>
          Halaman pendaftaran: <span className="break-all font-mono">https://{program.storeHost}/affiliate</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <ToggleRow
          title="Aktifkan program affiliate"
          description="Kode & link affiliate dihitung di checkout, dan halaman pendaftaran tampil di toko."
          checked={enabled}
          onCheckedChange={setEnabled}
          disabled={!canWrite}
        />
        <div className="grid gap-2">
          <Label htmlFor="aff-rate">Komisi standar (%)</Label>
          <Input id="aff-rate" className="max-w-40 tabular-nums" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} disabled={!canWrite} aria-describedby="aff-rate-help" />
          <p id="aff-rate-help" className="text-xs text-muted-foreground">Dari nilai produk setelah diskon — tanpa ongkir dan biaya admin.</p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="aff-hold">Masa tahan setelah pesanan selesai (hari)</Label>
          <Input id="aff-hold" className="max-w-40 tabular-nums" inputMode="numeric" value={hold} onChange={(e) => setHold(e.target.value)} disabled={!canWrite} aria-describedby="aff-hold-help" />
          <p id="aff-hold-help" className="text-xs text-muted-foreground">Komisi siap dibayar sekian hari setelah pesanan selesai (barang diterima), memberi waktu untuk retur. Standar 3 hari. Pesanan batal/retur tidak menghasilkan komisi.</p>
        </div>
      </CardContent>
      {canWrite && (
        <CardFooter>
          <Button
            disabled={pending}
            onClick={() =>
              run(
                // Raw strings: the server parses and REFUSES. `Number("10%") || 0` used to save a silent 0%.
                () => saveAffiliateSettings({ enabled, ratePct: rate, holdDays: hold }),
                "Pengaturan affiliate disimpan.",
              )
            }
          >
            {pending ? "Menyimpan…" : "Simpan pengaturan"}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

function ProductRatesCard({ program }: { program: AffiliateProgram }) {
  const canWrite = useCan("affiliates:write");
  const { pending, run } = useAction();
  const [productId, setProductId] = React.useState("");
  const [rate, setRate] = React.useState("");
  const overridden = new Set(program.overrides.map((o) => o.productId));
  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>Komisi per produk</CardTitle>
        <CardDescription>
          Produk tanpa pengaturan memakai komisi standar ({formatRateBps(program.settings.rateBps)}). Isi 0 untuk produk tanpa komisi.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {program.overrides.length > 0 && (
          <ul className="divide-y rounded-lg border">
            {program.overrides.map((o) => (
              <li key={o.productId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="truncate">{o.title}</span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums font-medium">{formatRateBps(o.rateBps)}</span>
                  {canWrite && (
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setProductAffiliateRate(o.productId, null), "Kembali ke komisi standar.")}>
                      Hapus
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {canWrite && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="grid min-w-0 flex-1 basis-56 gap-2">
              <Label htmlFor="aff-product">Produk</Label>
              <select
                id="aff-product"
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
              >
                <option value="">Pilih produk…</option>
                {program.products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}{overridden.has(p.id) ? " (sudah diatur)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid w-28 gap-2">
              <Label htmlFor="aff-product-rate">Komisi (%)</Label>
              <Input id="aff-product-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
            </div>
            <Button
              disabled={pending || !productId || rate.trim() === ""}
              onClick={() =>
                run(() => setProductAffiliateRate(productId, rate), "Komisi produk disimpan.")
              }
            >
              Simpan
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AddAffiliateDialog() {
  const canWrite = useCan("affiliates:write");
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, start] = React.useTransition();
  const [f, setF] = React.useState({ name: "", phone: "", email: "", code: "", bankName: "", bankAccount: "", bankHolder: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  if (!canWrite) return null;
  const save = () =>
    start(async () => {
      const r = await createAffiliate(f);
      if (!r.ok) return void toast.error(r.error);
      toast.success(`Affiliate ditambahkan dengan kode ${r.code}.`);
      setF({ name: "", phone: "", email: "", code: "", bankName: "", bankAccount: "", bankHolder: "" });
      setOpen(false);
      router.refresh();
    });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button>
            <Plus />
            Tambah affiliate
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Tambah affiliate</DialogTitle>
          <DialogDescription>Untuk orang yang sudah Anda kenal — langsung aktif. Kosongkan kode untuk dibuatkan otomatis.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field id="af-name" label="Nama" value={f.name} onChange={set("name")} autoComplete="off" />
          <Field id="af-phone" label="Nomor WhatsApp" value={f.phone} onChange={set("phone")} type="tel" inputMode="tel" autoComplete="off" placeholder="0812 3456 7890" />
          <Field id="af-email" label="Email (opsional)" value={f.email} onChange={set("email")} type="email" inputMode="email" autoComplete="off" />
          <Field id="af-code" label="Kode (opsional)" value={f.code} onChange={set("code")} placeholder="mis. SARI10" autoCapitalize="characters" />
          <div className="grid grid-cols-2 gap-3">
            <Field id="af-bank" label="Bank / e-wallet" value={f.bankName} onChange={set("bankName")} />
            <Field id="af-acct" label="No. rekening" value={f.bankAccount} onChange={set("bankAccount")} inputMode="numeric" />
          </div>
          <Field id="af-holder" label="Atas nama" value={f.bankHolder} onChange={set("bankHolder")} />
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline">Batal</Button>} />
          <Button disabled={pending || !f.name.trim() || !f.phone.trim()} onClick={save}>
            {pending ? "Menyimpan…" : "Simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The seller corrects an affiliate's contact / bank details. Code, status and account link are not here on purpose. */
function EditAffiliateDialog({ a, wide }: { a: AffiliateRow; wide?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, start] = React.useTransition();
  const initial = () => ({
    name: a.name,
    phone: a.phone,
    email: a.email ?? "",
    bankName: a.bankParts?.name ?? "",
    bankAccount: a.bankParts?.account ?? "",
    bankHolder: a.bankParts?.holder ?? "",
    note: a.note ?? "",
  });
  const [f, setF] = React.useState(initial);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const save = () =>
    start(async () => {
      const r = await updateAffiliate(a.id, f);
      if (!r.ok) return void toast.error(r.error);
      toast.success(`Data ${f.name.trim()} disimpan.`);
      setOpen(false);
      router.refresh();
    });
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setF(initial()); // always start from what the list shows now
        setOpen(next);
      }}
    >
      <DialogTrigger
        render={
          wide ? (
            <Button size="sm" variant="outline" className="h-10 flex-1">
              <Pencil />
              Ubah data
            </Button>
          ) : (
            <Button size="icon-sm" variant="ghost" aria-label={`Ubah data ${a.name}`} title="Ubah data affiliate">
              <Pencil />
            </Button>
          )
        }
      />
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ubah data affiliate</DialogTitle>
          <DialogDescription>
            Kode <b className="font-mono">{a.code}</b> dan link-nya tidak berubah. Komisi yang sudah tercatat juga tidak berubah.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field id={`ae-name-${a.id}`} label="Nama" value={f.name} onChange={set("name")} autoComplete="off" />
          <Field id={`ae-phone-${a.id}`} label="Nomor WhatsApp" value={f.phone} onChange={set("phone")} type="tel" inputMode="tel" autoComplete="off" />
          <Field id={`ae-email-${a.id}`} label="Email (opsional)" value={f.email} onChange={set("email")} type="email" inputMode="email" autoComplete="off" />
          <div className="grid grid-cols-2 gap-3">
            <Field id={`ae-bank-${a.id}`} label="Bank / e-wallet" value={f.bankName} onChange={set("bankName")} />
            <Field id={`ae-acct-${a.id}`} label="No. rekening" value={f.bankAccount} onChange={set("bankAccount")} inputMode="numeric" />
          </div>
          <Field id={`ae-holder-${a.id}`} label="Atas nama" value={f.bankHolder} onChange={set("bankHolder")} />
          <Field id={`ae-note-${a.id}`} label="Catatan (opsional)" value={f.note} onChange={set("note")} maxLength={200} />
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline">Batal</Button>} />
          <Button disabled={pending || !f.name.trim() || !f.phone.trim()} onClick={save}>
            {pending ? "Menyimpan…" : "Simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field(props:{ id: string; label: string } & React.ComponentProps<typeof Input>) {
  const { id, label, ...rest } = props;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} {...rest} />
    </div>
  );
}
