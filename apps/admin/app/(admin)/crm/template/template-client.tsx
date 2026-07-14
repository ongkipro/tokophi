"use client";

import * as React from "react";
import {
  Plus, MoreHorizontal, Pencil, Copy, Trash2, MessageSquare,
  ShoppingCart, CreditCard, PackageCheck, Star, Repeat, Megaphone,
} from "lucide-react";

import { PageHeader } from "@/components/admin/page-header";
import { fillTemplate } from "@tokophi/lib/format";
import { type WaTemplate, type FollowupType } from "@/lib/mock/store";

import { Card } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Badge } from "@tokophi/ui/badge";
import { Input } from "@tokophi/ui/input";
import { Label } from "@tokophi/ui/label";
import { Textarea } from "@tokophi/ui/textarea";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@tokophi/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator,
} from "@tokophi/ui/dropdown-menu";

type TemplType = FollowupType | "broadcast";

const typeMeta: Record<TemplType, { label: string; icon: React.ComponentType<{ className?: string }>; badge: string; dot: string }> = {
  keranjang: {
    label: "Keranjang",
    icon: ShoppingCart,
    badge: "border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/50 dark:text-amber-400",
    dot: "bg-amber-500",
  },
  pembayaran: {
    label: "Pembayaran",
    icon: CreditCard,
    badge: "border-red-200 bg-red-100 text-red-700 dark:border-red-900/50 dark:bg-red-950/50 dark:text-red-400",
    dot: "bg-red-500",
  },
  konfirmasi: {
    label: "Konfirmasi",
    icon: PackageCheck,
    badge: "border-blue-200 bg-blue-100 text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/50 dark:text-blue-400",
    dot: "bg-blue-500",
  },
  pascabeli: {
    label: "Pasca-beli",
    icon: MessageSquare,
    badge: "border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/50 dark:text-emerald-400",
    dot: "bg-emerald-500",
  },
  ulasan: {
    label: "Ulasan",
    icon: Star,
    badge: "border-yellow-200 bg-yellow-100 text-yellow-700 dark:border-yellow-900/50 dark:bg-yellow-950/50 dark:text-yellow-400",
    dot: "bg-yellow-500",
  },
  repeat: {
    label: "Repeat",
    icon: Repeat,
    badge: "border-violet-200 bg-violet-100 text-violet-700 dark:border-violet-900/50 dark:bg-violet-950/50 dark:text-violet-400",
    dot: "bg-violet-500",
  },
  broadcast: {
    label: "Broadcast",
    icon: Megaphone,
    badge: "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300",
    dot: "bg-slate-500",
  },
};

// Placeholder tokens + short gloss for the "Variabel tersedia" strip / insert chips.
const VARIABLES: { token: string; gloss: string }[] = [
  { token: "{{nama}}", gloss: "nama pelanggan" },
  { token: "{{produk}}", gloss: "nama produk" },
  { token: "{{no_pesanan}}", gloss: "nomor pesanan" },
  { token: "{{total}}", gloss: "total tagihan" },
  { token: "{{toko}}", gloss: "nama toko" },
];

// Sample values for the live-preview chat bubble.
const PREVIEW_VARS = {
  nama: "Rina",
  produk: "Kopi Arabika Gayo",
  no_pesanan: "#INV-4821",
  total: "Rp275.000",
  toko: "Toko Anda",
};

const JENIS: TemplType[] = ["keranjang", "pembayaran", "konfirmasi", "pascabeli", "ulasan", "repeat", "broadcast"];

function TypeBadge({ type }: { type: TemplType }) {
  const meta = typeMeta[type];
  const Icon = meta.icon;
  return (
    <Badge className={`gap-1 ${meta.badge}`}>
      <Icon className="size-3" /> {meta.label}
    </Badge>
  );
}

// Renders WhatsApp *bold* markers as actual bold, preserving the asterisks-free look per segment.
function renderBody(text: string) {
  const parts = text.split(/(\*[^*]+\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <strong key={i} className="font-semibold">{part.slice(1, -1)}</strong>;
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}

function CardActions() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Aksi template" />}>
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem><Pencil /> Edit</DropdownMenuItem>
        <DropdownMenuItem><Copy /> Duplikat</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive"><Trash2 /> Hapus</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TemplateCard({ t }: { t: WaTemplate }) {
  const filled = fillTemplate(t.body, PREVIEW_VARS);
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex items-start justify-between gap-2 border-b p-4">
        <div className="min-w-0 space-y-1.5">
          <p className="truncate font-medium leading-tight">{t.name}</p>
          <TypeBadge type={t.type} />
        </div>
        <CardActions />
      </div>

      {/* WhatsApp-style chat preview */}
      <div className="bg-muted/30 p-4">
        <div className="relative max-w-[92%] rounded-2xl rounded-tl-sm bg-emerald-50 px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-foreground shadow-sm dark:bg-emerald-950/30">
          {/* bubble tail */}
          <span className="absolute -left-1 top-0 size-3 rotate-45 rounded-sm bg-emerald-50 dark:bg-emerald-950/30" aria-hidden />
          {renderBody(filled)}
        </div>
      </div>

      <div className="flex items-center gap-1.5 border-t px-4 py-2.5 text-xs text-muted-foreground">
        <MessageSquare className="size-3.5" />
        {t.type === "broadcast" ? "Dipakai untuk broadcast massal" : "Dipakai di follow-up otomatis"}
      </div>
    </Card>
  );
}

function CreateTemplateDialog() {
  const [jenis, setJenis] = React.useState<TemplType>("keranjang");
  const meta = typeMeta[jenis];
  const JenisIcon = meta.icon;

  return (
    <Dialog>
      <DialogTrigger render={<Button><Plus /> Buat template</Button>} />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Buat template baru</DialogTitle>
          <DialogDescription>
            Susun pesan siap-pakai. Sisipkan variabel agar tiap pesan terisi otomatis sesuai pelanggan.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-1">
          <div className="grid gap-2">
            <Label htmlFor="tpl-nama">Nama template</Label>
            <Input id="tpl-nama" placeholder="mis. Pengingat pembayaran" autoComplete="off" />
          </div>

          <div className="grid gap-2">
            <Label>Jenis</Label>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" className="justify-start gap-2 font-normal">
                    <JenisIcon className="size-4" /> {meta.label}
                  </Button>
                }
              />
              <DropdownMenuContent align="start" className="w-48">
                {JENIS.map((j) => {
                  const m = typeMeta[j];
                  const Icon = m.icon;
                  return (
                    <DropdownMenuItem key={j} onClick={() => setJenis(j)}>
                      <Icon /> {m.label}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="tpl-isi">Isi pesan</Label>
            {/* Insert-placeholder chips (decorative) */}
            <div className="flex flex-wrap gap-1.5">
              {VARIABLES.map((v) => (
                <button
                  key={v.token}
                  type="button"
                  className="rounded-md border bg-muted/50 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                >
                  {v.token}
                </button>
              ))}
            </div>
            <Textarea
              id="tpl-isi"
              className="min-h-32 font-mono text-sm"
              placeholder="Halo kak {{nama}} 👋, pesanan {{no_pesanan}} sebesar {{total}} menunggu pembayaran… — {{toko}}"
            />
            <p className="text-xs text-muted-foreground">
              Gunakan <span className="font-mono">*teks*</span> untuk menebalkan tulisan seperti di WhatsApp.
            </p>
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline">Batal</Button>} />
          <DialogClose render={<Button>Simpan</Button>} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TemplateClient({ templates }: { templates: WaTemplate[] }) {
  return (
    <div>
      <PageHeader
        title="Template WhatsApp"
        desc="Pesan siap-pakai untuk follow-up dan broadcast ke pelanggan."
      >
        <CreateTemplateDialog />
      </PageHeader>

      {/* Variabel tersedia helper strip */}
      <div className="mb-5 flex flex-col gap-2.5 rounded-lg border bg-muted/40 p-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-5">
        <span className="text-sm font-medium">Variabel tersedia</span>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {VARIABLES.map((v) => (
            <span key={v.token} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <code className="rounded bg-background px-1.5 py-0.5 font-mono text-[11px] text-foreground shadow-sm">
                {v.token}
              </code>
              {v.gloss}
            </span>
          ))}
        </div>
      </div>

      {/* Template grid */}
      <div className="grid gap-4 sm:grid-cols-2">
        {templates.map((t) => (
          <TemplateCard key={t.id} t={t} />
        ))}
      </div>
    </div>
  );
}
