"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Plug, ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@tokophi/ui/button";
import { Input } from "@tokophi/ui/input";
import { Label } from "@tokophi/ui/label";
import { Badge } from "@tokophi/ui/badge";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@tokophi/ui/dialog";
import { cn } from "@tokophi/ui/lib/utils";
import type { ProviderKeyStatus, ProviderStatus } from "@/lib/data";
import { saveProviderCredentials, saveProviderOrderPrefix, setProviderEnv, testProviderKey } from "@/lib/actions";

// Task 8.33 — the platform's own provider keys, managed from the card instead of by redeploy.
//
// What is drawn: per slot, the MASKED tail ("…1234"), where it came from (stored / env fallback /
// nothing), when the stored key last passed a live test, a "Test koneksi" for that slot, and — for
// an owner — a password input to replace it. For KiriminAja, the environment switch, behind a
// confirm dialog that says what production means in money.
//
// Hiding the owner-only controls from an `admin` operator is courtesy; `platformGate("owner")`
// inside `saveProviderCredentials` / `setProviderEnv` is the boundary. The value typed here goes to
// the server action and nowhere else — never into state that outlives the submit, never into a toast.

type Env = "sandbox" | "production";
const ENV_LABEL: Record<Env, string> = { sandbox: "Sandbox", production: "Production" };

// WIB, pinned: the server renders this too, and a zone that follows the machine would hydrate one
// hour off on a laptop and read as a mismatch.
const WHEN = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });
const fmtWhen = (iso: string | null) => (iso ? WHEN.format(new Date(iso)) : null);

function sourceLine(s: ProviderKeyStatus): string {
  if (s.source === "db") return s.testedAt ? `diuji ${fmtWhen(s.testedAt)}` : "belum pernah diuji";
  if (s.source === "env") return "dari env container (cadangan) — belum ada kunci tersimpan";
  return "belum ada kunci";
}

/** One key slot: status line, per-slot test, and (owner) the replace form. */
function KeySlot({
  provider,
  env,
  label,
  status,
  canEdit,
  encryptionAvailable,
  active,
}: {
  provider: "kiriminaja" | "autolaris";
  env: Env;
  label: string;
  status: ProviderKeyStatus;
  canEdit: boolean;
  encryptionAvailable: boolean;
  /** Only the KiriminAja slots carry this — the slot bookings currently go through. */
  active?: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [saving, startSave] = useTransition();
  const [testing, startTest] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const id = `key-${provider}-${env}`;

  const save = () =>
    startSave(async () => {
      const r = await saveProviderCredentials(provider, env, value);
      setResult(r);
      if (r.ok) {
        setValue("");
        toast.success(r.message);
        router.refresh();
      } else toast.error(r.message);
    });
  const test = () =>
    startTest(async () => {
      const r = await testProviderKey(provider, env);
      setResult(r);
      if (r.ok) {
        toast.success(r.message);
        router.refresh();
      } else toast.error(r.message);
    });

  return (
    <div className="rounded-lg border bg-background p-3" data-key-slot={`${provider}:${env}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <KeyRound className="size-4 shrink-0 text-muted-foreground" />
          <span className="font-medium">{label}</span>
          {active && (
            <Badge variant="secondary" className="border-transparent bg-primary/12 text-primary">aktif</Badge>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs tabular-nums">{status.masked}</code>
          <Button variant="outline" size="sm" className="gap-1.5" disabled={testing || !status.present} onClick={test}>
            <Plug className="size-3.5" /> {testing ? "Menguji…" : "Test koneksi"}
          </Button>
        </div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{sourceLine(status)}</p>
      {result && (
        <p className={cn("mt-1 text-xs", result.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
          {result.ok ? "✓ " : "✕ "}{result.message}
        </p>
      )}
      {provider === "kiriminaja" && <PrefixSlot env={env} label={label} status={status} canEdit={canEdit} />}
      {canEdit && (
        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="min-w-0 flex-1 basis-56">
            <Label htmlFor={id} className="sr-only">Kunci API {label} baru</Label>
            <Input
              id={id}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={encryptionAvailable ? `Tempel kunci ${label.toLowerCase()} baru…` : "INTEGRATION_TOKEN_KEY belum diset — kunci tidak bisa disimpan"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              disabled={!encryptionAvailable || saving}
            />
          </div>
          <Button type="submit" size="sm" disabled={!encryptionAvailable || saving || value.trim().length === 0}>
            {saving ? "Menguji & menyimpan…" : "Uji & simpan"}
          </Button>
        </form>
      )}
    </div>
  );
}

/**
 * The order_id prefix registered on this env's ACCOUNT (0115). It sits inside the key slot because
 * it belongs to the same account as the key: switching env moves both. Read-only for `admin`, an
 * inline form for `owner` — the same rank as the key, since the prefix decides which account a
 * booking is filed under.
 */
function PrefixSlot({ env, label, status, canEdit }: { env: Env; label: string; status: ProviderKeyStatus; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(status.orderPrefix ?? "");
  const [saving, startSave] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const id = `prefix-kiriminaja-${env}`;
  const origin =
    status.orderPrefixSource === "db"
      ? "tersimpan di database"
      : status.orderPrefixSource === "env"
        ? "dari env KIRIMINAJA_ORDER_PREFIX (cadangan) — belum ada prefix tersimpan"
        : "bawaan kode — belum diatur";
  const save = () =>
    startSave(async () => {
      const r = await saveProviderOrderPrefix(env, value);
      setResult(r);
      if (r.ok) {
        setEditing(false);
        toast.success(r.message);
        router.refresh();
      }
    });
  return (
    <div className="mt-2 rounded-md border border-dashed border-border/70 px-2.5 py-2" data-prefix-slot={env}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs">
          <span className="text-muted-foreground">Prefix order_id: </span>
          <span className="font-mono font-semibold" data-prefix-value>{status.orderPrefix ?? "—"}</span>
          <span className="text-muted-foreground"> · {origin}</span>
        </p>
        {canEdit && !editing && (
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => { setResult(null); setValue(status.orderPrefix ?? ""); setEditing(true); }}>
            Ubah
          </Button>
        )}
      </div>
      {editing && (
        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="min-w-0 flex-1 basis-40">
            <Label htmlFor={id} className="sr-only">Prefix order_id {label}</Label>
            <Input
              id={id}
              autoComplete="off"
              spellCheck={false}
              maxLength={8}
              placeholder="contoh: PHI"
              value={value}
              onChange={(e) => setValue(e.target.value.toUpperCase())}
              disabled={saving}
              className="font-mono uppercase"
            />
          </div>
          <Button type="submit" size="sm" disabled={saving || value.trim().length < 3}>
            {saving ? "Menyimpan…" : "Simpan prefix"}
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setEditing(false)}>
            Batal
          </Button>
          <p className="basis-full text-xs text-muted-foreground">
            Harus sama persis dengan prefix yang terdaftar di dashboard KiriminAja {label.toLowerCase()} — tidak ada uji koneksi untuk prefix; booking pertama yang membuktikannya.
          </p>
        </form>
      )}
      {result && !result.ok && <p className="mt-1 text-xs text-red-600 dark:text-red-400">✕ {result.message}</p>}
    </div>
  );
}

export function KiriminajaKeys({ status, canEdit, encryptionAvailable }: { status: ProviderStatus["kiriminaja"]; canEdit: boolean; encryptionAvailable: boolean }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<Env | null>(null);
  const [switching, startSwitch] = useTransition();
  const doSwitch = (target: Env) =>
    startSwitch(async () => {
      const r = await setProviderEnv("kiriminaja", target);
      setConfirm(null);
      if (r.ok) {
        toast.success(r.message, { duration: 8000 });
        router.refresh();
      } else toast.error(r.message, { duration: 8000 });
    });
  const other: Env = status.activeEnv === "production" ? "sandbox" : "production";

  return (
    <div className="mb-3 space-y-2" data-provider-keys="kiriminaja">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Kunci API KiriminAja per lingkungan — tersimpan terenkripsi di database dan menang atas env container.
          {status.envSource === "env" && " Lingkungan aktif saat ini masih dari KIRIMINAJA_ENV (belum pernah dialihkan dari sini)."}
        </p>
        {canEdit && (
          <Button
            variant={other === "production" ? "default" : "outline"}
            size="sm"
            className="gap-1.5"
            disabled={switching}
            onClick={() => setConfirm(other)}
            data-env-switch
          >
            {other === "production" ? <ShieldAlert className="size-3.5" /> : <ShieldCheck className="size-3.5" />}
            {switching ? "Mengalihkan…" : `Alihkan ke ${ENV_LABEL[other]}`}
          </Button>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <KeySlot provider="kiriminaja" env="sandbox" label="Sandbox" status={status.sandbox} canEdit={canEdit} encryptionAvailable={encryptionAvailable} active={status.activeEnv === "sandbox"} />
        <KeySlot provider="kiriminaja" env="production" label="Production" status={status.production} canEdit={canEdit} encryptionAvailable={encryptionAvailable} active={status.activeEnv === "production"} />
      </div>

      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Alihkan KiriminAja ke {confirm ? ENV_LABEL[confirm] : ""}?</DialogTitle>
          </DialogHeader>
          {confirm === "production" ? (
            <div className="space-y-2 text-sm">
              <p>
                Setiap booking setelah ini adalah <b>pemesanan nyata, ditagihkan</b> — kurir benar-benar menjemput dan biaya
                ongkir benar-benar dipotong dari saldo.
              </p>
              <p className="text-muted-foreground">
                Kunci production ({status.production.masked}) akan diuji dulu ke server production; kalau ditolak, peralihan dibatalkan
                dan tidak ada yang berubah.
              </p>
            </div>
          ) : (
            <div className="space-y-2 text-sm">
              <p>Booking berikutnya masuk ke sandbox: bentuknya sama, tetapi <b>tidak ada kurir yang menjemput</b>.</p>
              <p className="text-muted-foreground">Kunci sandbox ({status.sandbox.masked}) diuji dulu; kalau ditolak, peralihan dibatalkan.</p>
            </div>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Batal</DialogClose>
            <Button variant={confirm === "production" ? "destructive" : "default"} disabled={switching} onClick={() => confirm && doSwitch(confirm)}>
              {switching ? "Menguji & mengalihkan…" : `Ya, alihkan ke ${confirm ? ENV_LABEL[confirm] : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function AutolarisKey({ status, canEdit, encryptionAvailable }: { status: ProviderKeyStatus; canEdit: boolean; encryptionAvailable: boolean }) {
  return (
    <div className="mb-3 space-y-2" data-provider-keys="autolaris">
      <p className="text-xs text-muted-foreground">
        Kunci API AutoLaris — satu lingkungan, tersimpan terenkripsi di database dan menang atas env container. Uji koneksi membuat satu tagihan QRIS
        minimal yang dibiarkan kedaluwarsa.
      </p>
      <KeySlot provider="autolaris" env="production" label="AutoLaris" status={status} canEdit={canEdit} encryptionAvailable={encryptionAvailable} />
    </div>
  );
}
