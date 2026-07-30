"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Percent, Tag, Truck, Dice5, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createDiscount, updateDiscount, deleteDiscount, type DiscountInput } from "@/lib/actions/discounts";
import { useCan } from "@/components/admin/permissions";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Input } from "@tokophi/ui/input";
import { Label } from "@tokophi/ui/label";
import { Badge } from "@tokophi/ui/badge";
import { Separator } from "@tokophi/ui/separator";
import { IDR, num } from "@tokophi/lib/format";
import { type Discount, type DiscountType } from "@/lib/mock/store";

// ---- option metadata ----
const TYPE_OPTIONS: {
  value: DiscountType;
  label: string;
  hint: string;
  icon: React.ElementType;
}[] = [
  { value: "persen", label: "Persentase", hint: "Potongan % dari total", icon: Percent },
  { value: "nominal", label: "Nominal", hint: "Potongan Rp tetap", icon: Tag },
  { value: "ongkir", label: "Gratis Ongkir", hint: "Bebas ongkos kirim", icon: Truck },
];

type EditableStatus = "aktif" | "terjadwal";

const STATUS_META: Record<
  Discount["status"],
  { label: string; className: string }
> = {
  aktif: {
    label: "Aktif",
    className:
      "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400",
  },
  terjadwal: {
    label: "Terjadwal",
    className: "bg-blue-500/10 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400",
  },
  nonaktif: {
    label: "Nonaktif",
    className: "bg-ink/10 text-muted-foreground",
  },
  kadaluarsa: {
    label: "Kadaluarsa",
    className: "bg-muted text-muted-foreground",
  },
};

function randomCode() {
  const words = ["HEMAT", "PROMO", "GAJIAN", "FLASH", "SPESIAL", "MERDEKA"];
  const w = words[Math.floor(Math.random() * words.length)];
  return `${w}${Math.floor(10 + Math.random() * 89)}`;
}

export function DiscountEditor({ discount }: { discount?: Discount }) {
  const isEdit = Boolean(discount);
  const canWrite = useCan("discounts:write");

  const [code, setCode] = React.useState(discount?.code ?? "");
  const [type, setType] = React.useState<DiscountType>(discount?.type ?? "persen");
  const [value, setValue] = React.useState(
    discount && discount.type !== "ongkir" ? String(discount.value) : "",
  );
  const [limit, setLimit] = React.useState(
    discount ? String(discount.limit) : "",
  );
  const [status, setStatus] = React.useState<EditableStatus>(
    discount?.status === "terjadwal" ? "terjadwal" : "aktif",
  );
  const [period, setPeriod] = React.useState(
    // `null` (no end date) seeds an EMPTY field, which round-trips back to `ends_at: NULL`. Seeding
    // "0" made a never-expiring voucher read as "berakhir dalam 0 hari" and re-saved it as one; and
    // for an ALREADY-expired voucher (negative days) `Math.max(0, …)` also produced "0", so pressing
    // Simpan on it wrote `ends_at: NULL` and resurrected it permanently.
    discount?.endsInDays == null ? "" : String(Math.max(0, discount.endsInDays)),
  );

  // Preview status: expired discounts stay expired in the header badge.
  const displayStatus: Discount["status"] =
    discount?.status === "kadaluarsa" ? "kadaluarsa" : status;
  const statusMeta = STATUS_META[displayStatus];

  const numericValue = Number(value) || 0;
  const previewValue =
    type === "persen"
      ? `${numericValue}%`
      : type === "nominal"
        ? IDR(numericValue)
        : "gratis ongkir";
  const previewCode = code || "KODE";

  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const buildInput = (): DiscountInput => ({
    code: code.trim(),
    type,
    value: numericValue,
    limit: limit ? Number(limit) : null,
    status,
    period: Number(period) || 0,
  });
  function handleSave() {
    if (!canWrite) {
      toast.error("Akses ditolak — peran Anda tidak bisa mengubah diskon");
      return;
    }
    if (!code.trim()) {
      toast.error("Kode diskon wajib diisi");
      return;
    }
    startTransition(async () => {
      try {
        if (isEdit && discount) {
          await updateDiscount(discount.id, buildInput());
          toast.success("Perubahan disimpan");
        } else {
          await createDiscount(buildInput());
          toast.success("Diskon dibuat");
        }
        router.push("/diskon");
        router.refresh();
      } catch {
        toast.error("Gagal menyimpan diskon (kode mungkin sudah dipakai)");
      }
    });
  }
  function handleDelete() {
    if (!discount) return;
    startTransition(async () => {
      try {
        await deleteDiscount(discount.id);
        toast.success(`Diskon ${discount.code} dihapus`);
        router.push("/diskon");
        router.refresh();
      } catch {
        toast.error("Gagal menghapus diskon");
      }
    });
  }

  const topBarTitle = isEdit ? code || "Tanpa kode" : "Buat diskon";

  return (
    <div className="mx-auto max-w-5xl">
      {/* Top bar */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <Link
            href="/diskon"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Diskon
          </Link>
          <div className="flex items-center gap-2.5">
            <h1 className="font-mono text-lg font-semibold tracking-tight">
              {topBarTitle}
            </h1>
            <Badge className={statusMeta.className}>{statusMeta.label}</Badge>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isEdit && canWrite && (
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={handleDelete}
              disabled={pending}
            >
              <Trash2 />
              Hapus diskon
            </Button>
          )}
          <Button nativeButton={false} variant="ghost" render={<Link href="/diskon" />}>
            Batal
          </Button>
          {canWrite && <Button onClick={handleSave} disabled={pending}>{pending ? "Menyimpan…" : "Simpan"}</Button>}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* MAIN column */}
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardContent className="flex flex-col gap-4">
              {/* Kode */}
              <div className="flex flex-col gap-2">
                <Label htmlFor="kode">Kode diskon</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="kode"
                    placeholder="mis. GAJIAN25"
                    className="font-mono uppercase"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => setCode(randomCode())}
                  >
                    <Dice5 />
                    Buat acak
                  </Button>
                </div>
              </div>

              <Separator />

              {/* Tipe */}
              <div className="flex flex-col gap-2">
                <Label>Tipe diskon</Label>
                <div className="grid gap-2 sm:grid-cols-3">
                  {TYPE_OPTIONS.map((o) => {
                    const Icon = o.icon;
                    const active = o.value === type;
                    return (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() => setType(o.value)}
                        className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors ${
                          active
                            ? "border-primary bg-primary/5 ring-1 ring-primary"
                            : "border-input hover:border-ring hover:bg-muted/40"
                        }`}
                      >
                        <Icon
                          className={`size-4 ${active ? "text-primary" : "text-muted-foreground"}`}
                        />
                        <span className="text-sm font-medium">{o.label}</span>
                        <span className="text-xs text-muted-foreground">{o.hint}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Nilai + Batas */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="nilai">Nilai</Label>
                  {type === "ongkir" ? (
                    <Input id="nilai" value="Gratis ongkir" disabled />
                  ) : (
                    <div className="flex items-center rounded-md border border-input focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
                      {type === "nominal" && (
                        <span className="pl-2.5 text-sm text-muted-foreground">Rp</span>
                      )}
                      <Input
                        id="nilai"
                        inputMode="numeric"
                        placeholder={type === "persen" ? "25" : "50000"}
                        value={value}
                        onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ""))}
                        className="border-0 pl-1.5 tabular-nums focus-visible:ring-0"
                      />
                      {type === "persen" && (
                        <span className="pr-2.5 text-sm text-muted-foreground">%</span>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="batas">Batas penggunaan</Label>
                  <Input
                    id="batas"
                    inputMode="numeric"
                    placeholder="1000"
                    value={limit}
                    onChange={(e) => setLimit(e.target.value.replace(/[^0-9]/g, ""))}
                    className="tabular-nums"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Jadwal */}
          <Card>
            <CardHeader>
              <CardTitle>Periode</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Label htmlFor="periode">Berakhir dalam (hari)</Label>
              <Input
                id="periode"
                inputMode="numeric"
                placeholder="30"
                value={period}
                onChange={(e) => setPeriod(e.target.value.replace(/[^0-9]/g, ""))}
                className="max-w-40 tabular-nums"
              />
              <p className="text-xs text-muted-foreground">
                {period
                  ? `Diskon berakhir dalam ${num(Number(period))} hari.`
                  : "Kosongkan untuk diskon tanpa batas waktu."}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* SIDEBAR column */}
        <div className="flex flex-col gap-4">
          {/* Status */}
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="inline-flex rounded-md border border-input p-0.5">
                <button
                  type="button"
                  onClick={() => setStatus("aktif")}
                  className={`flex-1 rounded-[6px] px-3 py-1.5 text-sm font-medium transition-colors ${
                    status === "aktif"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Aktif
                </button>
                <button
                  type="button"
                  onClick={() => setStatus("terjadwal")}
                  className={`flex-1 rounded-[6px] px-3 py-1.5 text-sm font-medium transition-colors ${
                    status === "terjadwal"
                      ? "bg-secondary text-secondary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Terjadwal
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                {status === "aktif"
                  ? "Langsung dapat digunakan pelanggan setelah disimpan."
                  : "Baru aktif saat periode dimulai."}
              </p>
            </CardContent>
          </Card>

          {/* Ringkasan / preview */}
          <Card>
            <CardHeader>
              <CardTitle>Pratinjau</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="rounded-lg border border-dashed border-border bg-muted/30 p-3">
                <p className="font-mono text-base font-bold">{previewCode}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {type === "ongkir"
                    ? "Pelanggan bebas ongkos kirim."
                    : `Pelanggan hemat ${previewValue} per pesanan.`}
                </p>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Batas penggunaan</span>
                <span className="font-medium tabular-nums">
                  {limit ? num(Number(limit)) : "Tanpa batas"}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
