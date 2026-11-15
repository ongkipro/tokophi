"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Badge } from "@tokophi/ui/badge";
import { Input } from "@tokophi/ui/input";
import { Label } from "@tokophi/ui/label";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@tokophi/ui/table";
import { cn } from "@tokophi/ui/lib/utils";
import { normalizeSignupCode } from "@tokophi/lib/signup-code";
import { BILLING } from "@tokophi/lib/billing";
import { IDR } from "@tokophi/lib/format";
import { createSignupCode, setSignupCodeActive } from "@/lib/actions";
import type { SignupCodeRow } from "@/lib/shipping-data";

// ADR 0019 — list, create, deactivate / re-activate. The actions are the boundary (rank + validation);
// this screen only shapes the input and reads their answer back.

const LABEL = { kiriminaja: "KiriminAja", mengantar: "Mengantar" } as const;
type Provider = keyof typeof LABEL;
const fmt = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" });

export function KodeDaftarClient({ codes, signupBase }: { codes: SignupCodeRow[]; signupBase: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [code, setCode] = useState("");
  const [provider, setProvider] = useState<Provider>("mengantar");
  const [note, setNote] = useState("");
  // ADR 0020 — first-invoice discount, stored per code. Pre-filled with the owner's default (Rp100.000);
  // 0 = a provider-only code. The action is the boundary (bounds in `parseSignupCodeDiscount`).
  const [discount, setDiscount] = useState(String(BILLING.SIGNUP_CODE_DISCOUNT_DEFAULT_IDR));
  const norm = normalizeSignupCode(code);
  const discountN = discount === "" ? 0 : Number(discount);
  const discountBad = !Number.isInteger(discountN) || discountN < 0 || discountN >= BILLING.MONTHLY_IDR;

  const run = (fn: () => Promise<{ ok: boolean; message: string }>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        toast.error(r.message);
        return;
      }
      toast.success(r.message);
      after?.();
      router.refresh();
    });

  const copy = async (c: string) => {
    try {
      await navigator.clipboard.writeText(`${signupBase}?kode=${encodeURIComponent(c)}`);
      toast.success("Tautan daftar disalin.");
    } catch {
      toast.error("Tidak bisa menyalin — salin tautannya dari kolom kode.");
    }
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Buat kode baru</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => createSignupCode(code, provider, note, discount), () => {
                setCode("");
                setNote("");
              });
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="sc-code">Kode</Label>
                <Input
                  id="sc-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  maxLength={32}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="MITRA-2026"
                  className="font-mono uppercase placeholder:normal-case"
                  aria-invalid={norm === null || undefined}
                  aria-describedby="sc-code-hint"
                />
                <p id="sc-code-hint" className={cn("text-xs", norm === null ? "text-destructive" : "text-muted-foreground")}>
                  3–32 karakter: huruf, angka, tanda minus. Disimpan huruf besar.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="sc-discount">Potongan tagihan pertama (Rp)</Label>
                <Input
                  id="sc-discount"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value.replace(/[^\d]/g, ""))}
                  inputMode="numeric"
                  maxLength={9}
                  autoComplete="off"
                  className="tabular-nums"
                  aria-invalid={discountBad || undefined}
                  aria-describedby="sc-discount-hint"
                />
                <p id="sc-discount-hint" className={cn("text-xs", discountBad ? "text-destructive" : "text-muted-foreground")}>
                  {discountBad
                    ? `Maksimal ${IDR(BILLING.MONTHLY_IDR - 1)} — harus di bawah harga bulanan.`
                    : discountN > 0
                      ? `Tagihan pertama: bulanan ${IDR(BILLING.MONTHLY_IDR - discountN)}, tahunan ${IDR(BILLING.ANNUAL_IDR - discountN)}. Sekali per toko; isi 0 bila tanpa potongan.`
                      : "Tanpa potongan — kode ini hanya menentukan penyedia pengiriman."}
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="sc-note">Catatan (opsional)</Label>
                <Input id="sc-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Mis. mitra gudang Surabaya" />
              </div>
              <fieldset className="flex flex-col gap-2 sm:col-span-2">
                <legend className="mb-2 text-sm font-medium">Penyedia pengiriman toko yang memakai kode ini</legend>
                <div role="radiogroup" aria-label="Penyedia pengiriman" className="flex flex-wrap gap-2">
                  {(Object.keys(LABEL) as Provider[]).map((p) => (
                    <Button
                      key={p}
                      type="button"
                      role="radio"
                      aria-checked={provider === p}
                      variant={provider === p ? "default" : "outline"}
                      size="sm"
                      onClick={() => setProvider(p)}
                    >
                      {LABEL[p]}
                    </Button>
                  ))}
                </div>
                {provider === "mengantar" && (
                  <p className="text-xs text-muted-foreground">
                    Calon seller melihat persetujuan Mengantar di halaman daftar; akunnya dibuat setelah toko disetujui.
                  </p>
                )}
              </fieldset>
            </div>
            <Button type="submit" disabled={pending || !norm || discountBad}>
              {pending ? "Menyimpan…" : "Buat kode"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Semua kode ({codes.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {codes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada kode. Tanpa kode, setiap toko baru memakai KiriminAja.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Kode</TableHead>
                    <TableHead>Penyedia</TableHead>
                    <TableHead className="text-right">Potongan tagihan pertama</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Dipakai</TableHead>
                    <TableHead>Catatan</TableHead>
                    <TableHead>Dibuat</TableHead>
                    <TableHead className="text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {codes.map((c) => (
                    <TableRow key={c.code} data-signup-code={c.code}>
                      <TableCell className="font-mono text-xs">{c.code}</TableCell>
                      <TableCell>{LABEL[c.provider]}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.discountIdr > 0 ? `−${IDR(c.discountIdr)}` : "—"}</TableCell>
                      <TableCell>
                        <Badge variant={c.active ? "default" : "outline"}>{c.active ? "Aktif" : "Nonaktif"}</Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{c.used} toko</TableCell>
                      <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground" title={c.note ?? undefined}>
                        {c.note ?? "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {fmt.format(c.createdAt)}
                        {c.createdBy ? ` · ${c.createdBy}` : ""}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          {c.active && (
                            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => copy(c.code)} aria-label={`Salin tautan daftar untuk ${c.code}`}>
                              <Copy className="size-3.5" /> Tautan
                            </Button>
                          )}
                          <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => setSignupCodeActive(c.code, !c.active))}>
                            {c.active ? "Nonaktifkan" : "Aktifkan"}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
