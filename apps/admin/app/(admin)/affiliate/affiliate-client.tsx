"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, MessageCircle, Plus, UserPlus, Users } from "lucide-react";

import { PageHeader } from "@/components/admin/page-header";
import { ToggleRow } from "@/components/admin/pengaturan/toggle-row";
import { useCan } from "@/components/admin/permissions";
import { IDR, num, waLink } from "@tokophi/lib/format";
import { formatRateBps } from "@tokophi/lib/affiliate";
import type { AffiliateProgram, AffiliateRow, CommissionState } from "@/lib/data/affiliates";
import {
  createAffiliate,
  inviteAffiliateToAccount,
  markCommissionPaid,
  saveAffiliateSettings,
  setAffiliateStatus,
  setProductAffiliateRate,
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

const STATE: Record<CommissionState, { label: string; className: string }> = {
  belum_selesai: { label: "Pesanan berjalan", className: "bg-blue-500/10 text-blue-700 dark:text-blue-400" },
  ditahan: { label: "Masa retur", className: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  siap: { label: "Siap dibayar", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  dibayar: { label: "Dibayar", className: "bg-muted text-muted-foreground" },
  batal: { label: "Batal", className: "bg-muted text-muted-foreground line-through" },
};
const AFF_STATUS: Record<AffiliateRow["status"], { label: string; className: string }> = {
  menunggu: { label: "Menunggu", className: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  aktif: { label: "Aktif", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  ditolak: { label: "Ditolak", className: "bg-muted text-muted-foreground" },
  nonaktif: { label: "Nonaktif", className: "bg-muted text-muted-foreground" },
};
const date = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "—";

export function AffiliateClient({ program }: { program: AffiliateProgram }) {
  const { settings, affiliates, commissions } = program;
  const waiting = affiliates.filter((a) => a.status === "menunggu").length;
  const ready = commissions.filter((c) => c.state === "siap");
  const owed = ready.reduce((s, c) => s + c.commissionIdr, 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Affiliate"
        desc="Ajak reseller & kreator mempromosikan toko Anda. Komisi dihitung otomatis dari pesanan; Anda membayarnya sendiri lalu menandainya lunas."
      >
        <AddAffiliateDialog />
      </PageHeader>

      {!settings.enabled && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="py-4 text-sm">
            Program affiliate <b>belum aktif</b>. Kode affiliate belum dihitung di checkout dan halaman pendaftaran
            belum tampil. Aktifkan di tab <b>Pengaturan</b>.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Affiliate aktif" value={num(affiliates.filter((a) => a.status === "aktif").length)} />
        <Stat label="Menunggu persetujuan" value={num(waiting)} />
        <Stat label="Komisi siap dibayar" value={IDR(owed)} />
      </div>

      <Tabs defaultValue={waiting ? "affiliate" : "komisi"}>
        <TabsList>
          <TabsTrigger value="komisi">Komisi</TabsTrigger>
          <TabsTrigger value="affiliate">Affiliate{waiting ? ` (${waiting} baru)` : ""}</TabsTrigger>
          <TabsTrigger value="pengaturan">Pengaturan</TabsTrigger>
        </TabsList>
        <TabsContent value="komisi" className="mt-4">
          <CommissionTable program={program} />
        </TabsContent>
        <TabsContent value="affiliate" className="mt-4">
          <AffiliateTable program={program} />
        </TabsContent>
        <TabsContent value="pengaturan" className="mt-4 grid gap-6">
          <SettingsCard program={program} />
          <ProductRatesCard program={program} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
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

function CommissionTable({ program }: { program: AffiliateProgram }) {
  const canWrite = useCan("affiliates:write");
  const { pending, run } = useAction();
  if (!program.commissions.length)
    return <Empty text="Belum ada pesanan dari affiliate. Komisi muncul di sini begitu pembeli memakai kode atau link affiliate." />;
  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Pesanan</TableHead>
            <TableHead>Affiliate</TableHead>
            <TableHead className="text-right">Nilai produk</TableHead>
            <TableHead className="text-right">Komisi</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {program.commissions.map((c) => (
            <TableRow key={c.id}>
              <TableCell>
                <div className="font-medium">{c.orderNumber}</div>
                <div className="text-xs text-muted-foreground">{date(c.createdAt)} · {c.source === "kode" ? "kode diketik" : "link"}</div>
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
                <Badge className={STATE[c.state].className}>{STATE[c.state].label}</Badge>
                {c.state === "ditahan" && <div className="mt-1 text-xs text-muted-foreground">bisa dibayar {date(c.eligibleAt)}</div>}
                {c.state === "dibayar" && <div className="mt-1 text-xs text-muted-foreground">{date(c.paidAt)}</div>}
              </TableCell>
              <TableCell className="text-right">
                {canWrite && c.state === "siap" && (
                  <Button size="sm" disabled={pending} onClick={() => run(() => markCommissionPaid(c.id), "Komisi ditandai dibayar.")}>
                    Tandai dibayar
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function AffiliateTable({ program }: { program: AffiliateProgram }) {
  const canWrite = useCan("affiliates:write");
  const { pending, run } = useAction();
  if (!program.affiliates.length)
    return (
      <Empty
        text={`Belum ada affiliate. Bagikan halaman pendaftaran https://${program.storeHost}/affiliate, atau tambahkan sendiri.`}
      />
    );
  const copy = (text: string) => navigator.clipboard.writeText(text).then(() => toast.success("Disalin."));
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
  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Affiliate</TableHead>
            <TableHead>Kode & link</TableHead>
            <TableHead className="text-right">Pesanan</TableHead>
            <TableHead className="text-right">Siap dibayar</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {program.affiliates.map((a) => {
            const link = `https://${program.storeHost}/?ref=${a.code}`;
            return (
              <TableRow key={a.id}>
                <TableCell>
                  <div className="font-medium">{a.name}</div>
                  <div className="text-xs text-muted-foreground">{a.phone}{a.email ? ` · ${a.email}` : ""}</div>
                  {a.bank && <div className="text-xs text-muted-foreground">{a.bank}</div>}
                  {a.note && <div className="mt-1 max-w-xs text-xs italic text-muted-foreground">“{a.note}”</div>}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <span className="font-mono text-sm">{a.code}</span>
                    <Button size="icon-sm" variant="ghost" aria-label={`Salin link ${a.code}`} onClick={() => copy(link)}>
                      <Copy />
                    </Button>
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{num(a.orders)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {IDR(a.owedIdr)}
                  {a.heldIdr > 0 && <div className="text-xs text-muted-foreground">+{IDR(a.heldIdr)} ditahan</div>}
                </TableCell>
                <TableCell>
                  <Badge className={AFF_STATUS[a.status].className}>{AFF_STATUS[a.status].label}</Badge>
                  {a.linked && <div className="mt-1 text-xs text-muted-foreground">Terhubung ke Akun TokoΦ</div>}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    {!a.contactMasked && (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        nativeButton={false}
                        aria-label={`WhatsApp ${a.name}`}
                        render={
                          <a
                            href={waLink(a.phone, `Halo ${a.name}, kode affiliate Anda: ${a.code}\nLink: ${link}`)}
                            target="_blank"
                            rel="noreferrer"
                          />
                        }
                      >
                        <MessageCircle />
                      </Button>
                    )}
                    {program.invites && a.status === "aktif" && !a.linked && (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Undang ${a.name} ke Akun TokoΦ`}
                        title="Undang ke Akun TokoΦ"
                        onClick={() => invite(a)}
                      >
                        <UserPlus />
                      </Button>
                    )}
                    {canWrite && a.status !== "aktif" && a.status !== "ditolak" && (
                      <Button size="sm" disabled={pending} onClick={() => run(() => setAffiliateStatus(a.id, "aktif"), "Affiliate disetujui.")}>
                        Setujui
                      </Button>
                    )}
                    {canWrite && a.status === "menunggu" && (
                      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => setAffiliateStatus(a.id, "ditolak"), "Pendaftaran ditolak.")}>
                        Tolak
                      </Button>
                    )}
                    {canWrite && a.status === "aktif" && (
                      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => setAffiliateStatus(a.id, "nonaktif"), "Affiliate dinonaktifkan.")}>
                        Nonaktifkan
                      </Button>
                    )}
                    {canWrite && a.status === "ditolak" && (
                      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => setAffiliateStatus(a.id, "aktif"), "Affiliate disetujui.")}>
                        Setujui
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
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
          Halaman pendaftaran: <span className="font-mono">https://{program.storeHost}/affiliate</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <ToggleRow
          title="Aktifkan program affiliate"
          description="Kode & link affiliate dihitung di checkout, dan halaman pendaftaran tampil di toko."
          checked={enabled}
          onCheckedChange={setEnabled}
          disabled={!canWrite}
        />
        <div className="grid gap-2">
          <Label htmlFor="aff-rate">Komisi standar (%)</Label>
          <Input id="aff-rate" className="max-w-40 tabular-nums" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} disabled={!canWrite} />
          <p className="text-xs text-muted-foreground">Dari nilai produk setelah diskon — tanpa ongkir dan biaya admin.</p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="aff-hold">Masa tunggu setelah barang diterima (hari)</Label>
          <Input id="aff-hold" className="max-w-40 tabular-nums" inputMode="numeric" value={hold} onChange={(e) => setHold(e.target.value)} disabled={!canWrite} />
          <p className="text-xs text-muted-foreground">Komisi siap dibayar sekian hari setelah pesanan selesai (barang diterima). Standar 3 hari. Pesanan batal/retur tidak menghasilkan komisi.</p>
        </div>
      </CardContent>
      {canWrite && (
        <CardFooter>
          <Button
            disabled={pending}
            onClick={() =>
              run(
                () => saveAffiliateSettings({ enabled, ratePct: Number(rate.replace(",", ".")) || 0, holdDays: Number(hold) || 0 }),
                "Pengaturan affiliate disimpan.",
              )
            }
          >
            {pending ? "Menyimpan…" : "Simpan"}
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
            <div className="grid min-w-56 flex-1 gap-2">
              <Label htmlFor="aff-product">Produk</Label>
              <select
                id="aff-product"
                className="h-9 rounded-md border bg-background px-2 text-sm"
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
                run(() => setProductAffiliateRate(productId, Number(rate.replace(",", ".")) || 0), "Komisi produk disimpan.")
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
          <DialogDescription>Langsung aktif. Kosongkan kode untuk dibuatkan otomatis.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field id="af-name" label="Nama" value={f.name} onChange={set("name")} />
          <Field id="af-phone" label="Nomor WhatsApp" value={f.phone} onChange={set("phone")} inputMode="numeric" />
          <Field id="af-email" label="Email (opsional)" value={f.email} onChange={set("email")} />
          <Field id="af-code" label="Kode (opsional)" value={f.code} onChange={set("code")} placeholder="mis. SARI10" />
          <div className="grid grid-cols-2 gap-3">
            <Field id="af-bank" label="Bank" value={f.bankName} onChange={set("bankName")} />
            <Field id="af-acct" label="No. rekening" value={f.bankAccount} onChange={set("bankAccount")} inputMode="numeric" />
          </div>
          <Field id="af-holder" label="Atas nama" value={f.bankHolder} onChange={set("bankHolder")} />
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline">Tutup</Button>} />
          <Button disabled={pending || !f.name.trim() || !f.phone.trim()} onClick={save}>
            {pending ? "Menyimpan…" : "Simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field(props: { id: string; label: string } & React.ComponentProps<typeof Input>) {
  const { id, label, ...rest } = props;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} {...rest} />
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
        <Users className="size-6" aria-hidden />
        {text}
      </CardContent>
    </Card>
  );
}
