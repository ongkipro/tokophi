"use client";
import * as React from "react";
import { toast } from "sonner";
import { Globe, Loader2, Copy, Check, Star, Trash2, ShieldCheck, TriangleAlert, Lock, ExternalLink, LifeBuoy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Input } from "@tokophi/ui/input";
import { Badge } from "@tokophi/ui/badge";
import { useCan } from "@/components/admin/permissions";
import type { StoreDomainRow } from "@/lib/data/domain";
import { listDomains, addDomain, verifyDomain, setPrimaryDomain, removeDomain, requestDomainChange } from "@/lib/actions/domain";

// Once a hostname exists at the TLS provider it is locked even if activation later enters `error`;
// deleting only the DB row would orphan a certificate-bearing hostname at the edge.
const isLocked = (domain: StoreDomainRow) =>
  domain.providerAttached || domain.status === "provisioning" || domain.status === "active";

// Pengaturan → Domain. TXT ownership, Cloudflare hostname registration, certificate polling, and the
// final `active` transition are real. The seller can only promote a domain after the provider reports
// both hostname and certificate active.

type StatusMeta = { label: string; tone: "muted" | "amber" | "green" | "red"; hint: string };
const STATUS: Record<StoreDomainRow["status"], StatusMeta> = {
  pending: { label: "Belum diverifikasi", tone: "muted", hint: "Tambahkan record DNS di bawah, lalu klik Verifikasi." },
  verifying: { label: "Menunggu DNS", tone: "amber", hint: "Record belum terbaca. DNS bisa perlu waktu hingga beberapa jam." },
  provisioning: { label: "Menunggu aktivasi", tone: "amber", hint: "Kepemilikan terverifikasi. Sertifikat keamanan sedang diterbitkan otomatis." },
  active: { label: "Aktif", tone: "green", hint: "Domain melayani tokomu." },
  error: { label: "Bermasalah", tone: "red", hint: "" },
  disabled: { label: "Nonaktif", tone: "muted", hint: "" },
};

const toneClass: Record<StatusMeta["tone"], string> = {
  muted: "bg-muted text-muted-foreground",
  amber: "bg-amber-100 text-amber-800",
  green: "bg-emerald-100 text-emerald-800",
  red: "bg-red-100 text-red-700",
};

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(value).then(
            () => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            },
            () => {},
          );
        }}
        className="mt-1 flex w-full items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-left font-mono text-xs transition-colors hover:border-primary/40"
        title="Salin"
      >
        <span className="truncate">{value}</span>
        {copied ? <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" /> : <Copy className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
      </button>
    </div>
  );
}

// One DNS record shown the way a registrar's panel asks for it: Tipe · Nama/Host · Nilai. The Name is
// the crux for beginners — for a root/apex domain most panels want `@` (or an empty Name), for `www`
// they want `www`. We spell it out so nobody pastes the full domain into the Name box.
function RecordCard({ type, name, value, note }: { type: string; name: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="grid gap-2 sm:grid-cols-[auto_1fr]">
        <div className="flex items-center gap-2">
          <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-primary">{type}</span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <CopyField label="Nama / Host" value={name} />
          <CopyField label="Nilai / Value" value={value} />
        </div>
      </div>
      {note && <p className="mt-2 text-[11px] text-muted-foreground">{note}</p>}
    </div>
  );
}

export function DomainCard() {
  const canWrite = useCan("settings:write");
  const [rows, setRows] = React.useState<StoreDomainRow[] | null>(null);
  const [cnameTarget, setCnameTarget] = React.useState("cname.tokophi.cc");
  const [systemDomain, setSystemDomain] = React.useState("");
  const [host, setHost] = React.useState("");
  const [busy, start] = React.useTransition();
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    listDomains().then(
      (r) => {
        setRows(r.rows);
        setCnameTarget(r.cnameTarget);
        setSystemDomain(r.systemDomain);
      },
      () => setRows([]),
    );
  }, []);
  React.useEffect(() => load(), [load]);

  const run = (id: string | null, fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) => {
    setBusyId(id);
    start(async () => {
      const res = await fn();
      setBusyId(null);
      if (res.ok) {
        toast.success(okMsg);
        load();
      } else {
        toast.error(res.error ?? "Gagal.");
        load();
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="h-5 w-5" /> Domain
        </CardTitle>
        <CardDescription>
          Tokomu selalu punya alamat bawaan di <span className="font-mono">.tokophi.id</span>. Kamu juga
          bisa menghubungkan domain milikmu sendiri (mis. <span className="font-mono">namadomaintokomu.com</span>).
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* System domain — always on, assigned by the platform, NOT editable by the merchant.
            This is <slug>.tokophi.id, derived from the store slug (see systemDomainFor). */}
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Domain bawaan
          </p>
          <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-muted/30 p-4">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-600" />
              <div className="min-w-0">
                <p className="truncate font-mono text-sm font-medium">
                  {systemDomain || <span className="text-muted-foreground">memuat…</span>}
                </p>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                  <Lock className="h-3 w-3" /> Aktif otomatis · diatur sistem, tidak bisa diubah
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge className="bg-emerald-100 text-emerald-800">Aktif</Badge>
              {systemDomain && (
                <Button
                  size="sm"
                  variant="ghost"
                  nativeButton={false}
                  render={
                    <a href={`https://${systemDomain}`} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="mr-1 h-3.5 w-3.5" /> Kunjungi
                    </a>
                  }
                />
              )}
            </div>
          </div>
        </div>

        <div className="border-t pt-5">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Domain kustom
          </p>
          <p className="mb-3 text-xs text-muted-foreground">
            Punya domain sendiri? Hubungkan agar storefront tampil di alamatmu. Pengunjung di alamat
            bawaan akan diarahkan ke domain utama. Batas: <span className="font-medium text-foreground">satu domain utama + satu www</span> (mis.{" "}
            <span className="font-mono">namadomaintokomu.com</span> dan <span className="font-mono">www.namadomaintokomu.com</span>).
          </p>
          <div className="space-y-4">
        {/* Add */}
        {canWrite && (
          <div className="flex flex-col gap-2 sm:flex-row">
            {/* No visible label — the field sits under its own explanatory paragraph. Without this
                the browser fell back to the placeholder, so the box was announced as
                "namadomaintokomu.com": an example value standing in for the field's purpose. */}
            <Input
              aria-label="Domain kustom"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="namadomaintokomu.com"
              inputMode="url"
              autoCapitalize="none"
              spellCheck={false}
              onKeyDown={(e) => {
                if (e.key === "Enter" && host.trim() && !busy) run(null, () => addDomain(host).then((r) => (r.ok && setHost(""), r)), "Domain ditambahkan.");
              }}
            />
            <Button
              disabled={!host.trim() || busy}
              onClick={() => run(null, () => addDomain(host).then((r) => (r.ok && setHost(""), r)), "Domain ditambahkan.")}
            >
              {busy && busyId === null ? <Loader2 className="h-4 w-4 animate-spin" /> : "Tambah"}
            </Button>
          </div>
        )}

        {/* List */}
        {rows === null ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Memuat…
          </div>
        ) : rows.length === 0 ? (
          <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
            Belum ada domain kustom. Tambahkan domainmu untuk mulai.
          </p>
        ) : (
          <ul className="space-y-4">
            {rows.map((d) => {
              const meta = STATUS[d.status];
              const rowBusy = busy && busyId === d.id;
              return (
                <li key={d.id} className="rounded-xl border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium">{d.host}</span>
                      {d.isPrimary && (
                        <Badge className="gap-1 bg-primary/10 text-primary">
                          <Star className="h-3 w-3" /> Utama
                        </Badge>
                      )}
                      <Badge className={toneClass[meta.tone]}>{meta.label}</Badge>
                    </div>
                    {canWrite && (
                      <div className="flex items-center gap-1">
                        {d.status === "active" && !d.isPrimary && (
                          <Button size="sm" variant="ghost" disabled={rowBusy} onClick={() => run(d.id, () => setPrimaryDomain(d.id), "Domain utama diperbarui.")}>
                            <Star className="mr-1 h-3.5 w-3.5" /> Jadikan utama
                          </Button>
                        )}
                        {(d.status === "pending" || d.status === "verifying" || d.status === "error") && (
                          <Button size="sm" disabled={rowBusy} onClick={() => run(d.id, () => verifyDomain(d.id), d.status === "error" ? "Aktivasi diperiksa ulang." : "Kepemilikan terverifikasi.")}>
                            {rowBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><ShieldCheck className="mr-1 h-3.5 w-3.5" /> {d.status === "error" ? "Coba lagi" : "Verifikasi"}</>}
                          </Button>
                        )}
                        {isLocked(d) ? (
                          // Verified/locked: no self-serve delete. The seller opens a ticket; super-admin acts.
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-muted-foreground hover:text-foreground"
                            disabled={rowBusy}
                            title="Ajukan perubahan domain (lewat tim kami)"
                            onClick={() => {
                              const note = window.prompt(`Ajukan perubahan/penghapusan domain ${d.host}. Alasan (opsional):`);
                              if (note === null) return; // cancelled
                              run(d.id, () => requestDomainChange(d.id, note), "Permintaan terkirim — tim kami akan memprosesnya.");
                            }}
                          >
                            <LifeBuoy className="mr-1 h-3.5 w-3.5" /> Ajukan perubahan
                          </Button>
                        ) : (
                          <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-red-600" disabled={rowBusy} title="Hapus domain" onClick={() => run(d.id, () => removeDomain(d.id), "Domain dihapus.")}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    )}
                  </div>

                  <p className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground">
                    {meta.tone === "amber" && <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />}
                    {d.status === "error" && d.lastError
                      ? d.lastError
                      : d.status === "active"
                        ? d.isPrimary
                          ? "Domain utama — semua pengunjung diarahkan ke sini."
                          : "Aktif — pengunjung dialihkan ke domain utama. Klik “Jadikan utama” untuk membalik arah."
                        : meta.hint}
                  </p>

                  {/* DNS records — shown until the domain is live. A merchant needs them to set up DNS,
                      and again to debug a stuck verification. Name/Host spelled out: `@` for a root
                      domain, `www` for the www one — the #1 thing beginners get wrong. */}
                  {(d.status === "pending" || d.status === "verifying" || d.status === "provisioning") && (
                    (() => {
                      const isWww = /^www\./i.test(d.host);
                      return (
                        <div className="mt-3 space-y-2">
                          <p className="text-xs font-medium">Tambahkan 2 record ini di panel DNS domainmu:</p>
                          <RecordCard
                            type="CNAME"
                            name={isWww ? "www" : "@"}
                            value={cnameTarget}
                            note={isWww ? "Nama diisi “www”." : "Untuk domain utama (tanpa www), isi Nama dengan “@” atau kosongkan (tergantung penyedia)."}
                          />
                          <RecordCard
                            type="TXT"
                            name={isWww ? "_tokophi-verify.www" : "_tokophi-verify"}
                            value={d.txtValue}
                            note="Bukti kepemilikan. Bisa dihapus setelah domain aktif."
                          />
                        </div>
                      );
                    })()
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* Shopify-style step-by-step tutorial */}
        <div className="mt-4 rounded-xl border bg-muted/20 p-4">
          <p className="mb-3 text-sm font-medium">Cara menghubungkan domain</p>
          <ol className="space-y-2.5 text-xs text-muted-foreground">
            <li className="flex gap-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">1</span>
              <span>Ketik domainmu di kolom atas (mis. <span className="font-mono">namadomaintokomu.com</span> atau <span className="font-mono">www.namadomaintokomu.com</span>), lalu klik <span className="font-medium text-foreground">Tambah</span>.</span>
            </li>
            <li className="flex gap-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">2</span>
              <span>Buka panel DNS di penyedia domainmu, lalu buat dua record yang kami tampilkan: satu <span className="font-medium text-foreground">CNAME</span> mengarah ke <span className="font-mono">{cnameTarget}</span>, dan satu <span className="font-medium text-foreground">TXT</span> untuk bukti kepemilikan.</span>
            </li>
            <li className="flex gap-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">3</span>
              <span>Klik <span className="font-medium text-foreground">Verifikasi</span>. Setelah kepemilikan terbukti, sertifikat keamanan (SSL) diterbitkan otomatis — biasanya beberapa menit. Perubahan DNS bisa perlu waktu hingga 24 jam.</span>
            </li>
            <li className="flex gap-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">4</span>
              <span>Saat statusnya <span className="font-medium text-foreground">Aktif</span>, klik <span className="font-medium text-foreground">Jadikan utama</span> agar semua pengunjung diarahkan ke domainmu.</span>
            </li>
          </ol>
          <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Domain tanpa <span className="font-mono">www</span>?</span>{" "}
            Sebagian penyedia tidak mengizinkan CNAME di domain utama. Solusinya: pakai <span className="font-mono">www.namadomaintokomu.com</span> sebagai
            domain utama lalu arahkan (redirect) domain polosmu ke sana, atau gunakan fitur CNAME-flattening/ALIAS bila tersedia.
            Email di domainmu tidak terpengaruh.
          </p>
          <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
            <Lock className="mt-0.5 h-3 w-3 shrink-0" />
            Setelah domain <span className="font-medium text-foreground">aktif</span>, ia dikunci demi keamanan. Untuk mengubah atau
            melepasnya, klik <span className="font-medium text-foreground">Ajukan perubahan</span> — tim kami yang memproses lewat tiket.
          </p>
        </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
