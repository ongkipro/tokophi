"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import { CreditCard, Truck, Users, UserPlus, Save } from "lucide-react";
import { toast } from "sonner";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@indostore/ui/card";
import { Button } from "@indostore/ui/button";
import { Badge } from "@indostore/ui/badge";
import { Switch } from "@indostore/ui/switch";
import { Label } from "@indostore/ui/label";
import { Separator } from "@indostore/ui/separator";
import { Avatar, AvatarFallback } from "@indostore/ui/avatar";
import { cn } from "@indostore/ui/lib/utils";

type Toggle = { key: string; name: string; desc: string; on: boolean };

const INITIAL_GATEWAYS: Toggle[] = [
  { key: "midtrans", name: "Midtrans", desc: "QRIS, VA, kartu kredit", on: true },
  { key: "xendit", name: "Xendit", desc: "VA, e-wallet, retail", on: true },
  { key: "duitku", name: "Duitku", desc: "VA & e-wallet", on: false },
  { key: "cod", name: "COD (Bayar di Tempat)", desc: "Ditanggung platform; limit & area diatur di sini", on: true },
];

const INITIAL_COURIERS: Toggle[] = [
  { key: "jne", name: "JNE", desc: "Reguler, YES, OKE", on: true },
  { key: "jnt", name: "J&T Express", desc: "EZ, Ekonomi", on: true },
  { key: "sicepat", name: "SiCepat", desc: "REG, BEST, GOKIL", on: true },
  { key: "anteraja", name: "AnterAja", desc: "Reguler, Same Day", on: true },
  { key: "pos", name: "Pos Indonesia", desc: "Kilat Khusus, Reguler", on: false },
  { key: "gosend", name: "GoSend", desc: "Instant, Same Day", on: true },
  { key: "grab", name: "GrabExpress", desc: "Instant, Same Day", on: true },
];

const TEAM = [
  { name: "Ongki Pratama", email: "ongki@indostore.id", role: "Owner" },
  { name: "Rani Kusuma", email: "rani@indostore.id", role: "Admin" },
  { name: "Andi Wijaya", email: "andi@indostore.id", role: "Support" },
];

const ROLE_CLASS: Record<string, string> = {
  Owner: "bg-primary/10 text-primary",
  Admin: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  Support: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

export default function PengaturanPage() {
  const [gateways, setGateways] = useState(INITIAL_GATEWAYS);
  const [couriers, setCouriers] = useState(INITIAL_COURIERS);

  const toggle = (
    setter: Dispatch<SetStateAction<Toggle[]>>,
    key: string,
    on: boolean,
  ) => setter((prev) => prev.map((t) => (t.key === key ? { ...t, on } : t)));

  return (
    <div className="mx-auto max-w-[1000px] space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Pengaturan</h1>
        <p className="text-sm text-muted-foreground">
          Gateway pembayaran, COD, dan kurir diatur di sini oleh platform — berlaku untuk{" "}
          <span className="font-medium text-foreground">semua toko</span>. Merchant hanya mengaktifkan metode di tokonya.
        </p>
      </div>

      {/* payment gateways */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="size-4 text-muted-foreground" /> Gateway
            Pembayaran
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-0">
          {gateways.map((g, i) => (
            <div key={g.key}>
              {i > 0 && <Separator />}
              <div className="flex items-center justify-between py-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`gw-${g.key}`} className="font-medium">
                      {g.name}
                    </Label>
                    {g.on && (
                      <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                        Terhubung
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{g.desc}</p>
                </div>
                <Switch
                  id={`gw-${g.key}`}
                  checked={g.on}
                  onCheckedChange={(v) => toggle(setGateways, g.key, v)}
                />
              </div>
            </div>
          ))}
          <div className="flex justify-end pt-3">
            <Button
              className="gap-1.5"
              onClick={() => toast.success("Pengaturan pembayaran disimpan.")}
            >
              <Save className="size-4" /> Simpan
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* couriers */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Truck className="size-4 text-muted-foreground" /> Integrasi Kurir
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-0">
          <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900/50 dark:bg-emerald-950/30">
            <div className="flex items-center gap-2 text-sm">
              <Truck className="size-4 text-emerald-600 dark:text-emerald-400" />
              <span>
                Agregator pengiriman: <span className="font-medium">Biteship</span> · API kurir dikelola platform
              </span>
            </div>
            <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">Terhubung</Badge>
          </div>
          <p className="mb-2 text-xs text-muted-foreground">
            Kurir disediakan lewat agregator. Aktifkan yang tersedia untuk semua toko — merchant lalu memilih kurir &amp; layanannya.
          </p>
          {couriers.map((c, i) => (
            <div key={c.key}>
              {i > 0 && <Separator />}
              <div className="flex items-center justify-between py-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`ku-${c.key}`} className="font-medium">
                      {c.name}
                    </Label>
                    {c.on && (
                      <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                        Aktif
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{c.desc}</p>
                </div>
                <Switch
                  id={`ku-${c.key}`}
                  checked={c.on}
                  onCheckedChange={(v) => toggle(setCouriers, c.key, v)}
                />
              </div>
            </div>
          ))}
          <div className="flex justify-end pt-3">
            <Button
              className="gap-1.5"
              onClick={() => toast.success("Pengaturan kurir disimpan.")}
            >
              <Save className="size-4" /> Simpan
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* platform team */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Users className="size-4 text-muted-foreground" /> Tim Platform
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => toast.success("Undangan terkirim.")}
          >
            <UserPlus className="size-4" /> Undang
          </Button>
        </CardHeader>
        <CardContent className="space-y-0">
          {TEAM.map((m, i) => (
            <div key={m.email}>
              {i > 0 && <Separator />}
              <div className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <Avatar className="size-9">
                    <AvatarFallback className="text-xs font-medium">
                      {initials(m.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="font-medium">{m.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {m.email}
                    </div>
                  </div>
                </div>
                <Badge className={cn(ROLE_CLASS[m.role])}>{m.role}</Badge>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
