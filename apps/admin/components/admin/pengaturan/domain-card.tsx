"use client";
import * as React from "react";
import { toast } from "sonner";
import { Globe, Loader2, Copy, Check, Star, Trash2, ShieldCheck, TriangleAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Input } from "@tokophi/ui/input";
import { Badge } from "@tokophi/ui/badge";
import { useCan } from "@/components/admin/permissions";
import type { StoreDomainRow } from "@/lib/data/domain";
import { listDomains, addDomain, verifyDomain, setPrimaryDomain, removeDomain } from "@/lib/actions/domain";

// Pengaturan → Domain. A merchant attaches their own domain (toko.com) to their storefront.
// CUSTOM_DOMAIN.md.
//
// HONESTY: this screen can add a domain and verify TXT ownership for real. It CANNOT flip a domain to
// "active" — a shopper is only served once a TLS cert is issued (Cloudflare-for-SaaS, not built yet),
// which is a platform step. So a verified domain rests at "provisioning" and this UI says exactly
// that, rather than pretending the domain is live. The rule of this codebase is that a control must
// not claim what the system cannot do.

type StatusMeta = { label: string; tone: "muted" | "amber" | "green" | "red"; hint: string };
const STATUS: Record<StoreDomainRow["status"], StatusMeta> = {
  pending: { label: "Belum diverifikasi", tone: "muted", hint: "Tambahkan record DNS di bawah, lalu klik Verifikasi." },
  verifying: { label: "Menunggu DNS", tone: "amber", hint: "Record belum terbaca. DNS bisa perlu waktu hingga beberapa jam." },
  provisioning: { label: "Menunggu aktivasi", tone: "amber", hint: "Kepemilikan terverifikasi. Sertifikat sedang disiapkan tim kami — kamu akan diberi tahu saat aktif." },
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

export function DomainCard() {
  const canWrite = useCan("settings:write");
  const [rows, setRows] = React.useState<StoreDomainRow[] | null>(null);
  const [cnameTarget, setCnameTarget] = React.useState("cname.tokophi.com");
  const [host, setHost] = React.useState("");
  const [busy, start] = React.useTransition();
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    listDomains().then(
      (r) => {
        setRows(r.rows);
        setCnameTarget(r.cnameTarget);
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
          <Globe className="h-5 w-5" /> Domain Kustom
        </CardTitle>
        <CardDescription>
          Pakai domain milikmu sendiri (mis. <span className="font-mono">toko-kamu.com</span>) untuk storefront.
          Tanpa ini, tokomu tetap bisa diakses di <span className="font-mono">{"<toko>"}.tokophi.com</span>.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Add */}
        {canWrite && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="toko-kamu.com"
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
                        {(d.status === "pending" || d.status === "verifying") && (
                          <Button size="sm" disabled={rowBusy} onClick={() => run(d.id, () => verifyDomain(d.id), "Kepemilikan terverifikasi.")}>
                            {rowBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><ShieldCheck className="mr-1 h-3.5 w-3.5" /> Verifikasi</>}
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-red-600" disabled={rowBusy} onClick={() => run(d.id, () => removeDomain(d.id), "Domain dihapus.")}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>

                  <p className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground">
                    {meta.tone === "amber" && <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />}
                    {d.status === "error" && d.lastError ? d.lastError : meta.hint}
                  </p>

                  {/* DNS records — shown until the domain is live. A merchant needs them to set up DNS,
                      and again to debug a stuck verification. */}
                  {(d.status === "pending" || d.status === "verifying" || d.status === "provisioning") && (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <CopyField label="CNAME — arahkan domainmu ke" value={cnameTarget} />
                      <CopyField label={`TXT — ${d.txtName}`} value={d.txtValue} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <p className="text-xs text-muted-foreground">
          Cara setup: di panel DNS domainmu, buat <span className="font-medium">CNAME</span> yang mengarah ke{" "}
          <span className="font-mono">{cnameTarget}</span>, dan satu record <span className="font-medium">TXT</span> untuk
          verifikasi kepemilikan. Lalu klik Verifikasi. Domain apex (tanpa <span className="font-mono">www</span>) mungkin
          perlu fitur CNAME-flattening/ALIAS di registrar-mu.
        </p>
      </CardContent>
    </Card>
  );
}
