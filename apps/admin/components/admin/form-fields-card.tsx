"use client";

import type { FormConfig } from "@tokophi/lib/form-config";
import { Card, CardHeader, CardTitle, CardContent } from "@tokophi/ui/card";
import { Switch } from "@tokophi/ui/switch";

// Toggles for the OPTIONAL order-form elements, shared by the product-promo and custom-HTML editors.
// The 4 core COD fields are listed as always-on (they can't be hidden without breaking a COD order).
const TOGGLES: { key: keyof FormConfig; label: string; hint: string }[] = [
  { key: "email", label: "Kolom Email", hint: "Field email opsional (tidak wajib diisi pembeli)." },
  { key: "quantity", label: "Pemilih Jumlah", hint: "Stepper − / + agar pembeli bisa beli lebih dari 1." },
  { key: "trustBadges", label: "Badge Kepercayaan", hint: "Baris DATA AMAN · PRODUK ASLI · BAYAR DI TEMPAT." },
  { key: "summary", label: "Ringkasan Pesanan", hint: "Rincian subtotal + ongkir + total di dalam form." },
];

export function FormFieldsCard({
  value,
  onChange,
  disabled,
}: {
  value: FormConfig;
  onChange: (key: keyof FormConfig, v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Field Form</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          Selalu tampil (wajib untuk COD): <span className="font-medium text-foreground">Nama · WhatsApp · Alamat · Kecamatan</span>.
        </p>
        {TOGGLES.map((t) => (
          <div key={t.key} className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium">{t.label}</div>
              <p className="text-xs text-muted-foreground">{t.hint}</p>
            </div>
            <Switch checked={value[t.key]} onCheckedChange={(v) => onChange(t.key, v)} disabled={disabled} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
