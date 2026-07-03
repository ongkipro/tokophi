"use client";

import * as React from "react";
import {
  Plus,
  Send,
  MoreHorizontal,
  MessageSquare,
  Camera,
  Music2,
  UserPlus,
  Store,
  Clock,
  type LucideIcon,
} from "lucide-react";

import { PageHeader } from "@/components/admin/page-header";
import { IDR, waLink, fillTemplate } from "@/lib/format";
import {
  type Lead,
  type LeadStage,
  type LeadSource,
  type WaTemplate,
} from "@/lib/mock/store";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const STORE_NAME = "Batik Nusantara";

// Board columns (kalah is intentionally excluded — still counted for closing rate).
const COLUMNS: { stage: LeadStage; title: string; accent: string }[] = [
  { stage: "baru", title: "Baru", accent: "bg-slate-400" },
  { stage: "dihubungi", title: "Dihubungi", accent: "bg-blue-500" },
  { stage: "nego", title: "Negosiasi", accent: "bg-amber-500" },
  { stage: "closing", title: "Closing", accent: "bg-violet-500" },
  { stage: "menang", title: "Menang", accent: "bg-emerald-500" },
];

const SOURCE_META: Record<
  LeadSource,
  { icon: LucideIcon; className: string }
> = {
  WhatsApp: { icon: MessageSquare, className: "text-emerald-600" },
  Instagram: { icon: Camera, className: "text-pink-500" },
  TikTok: { icon: Music2, className: "text-foreground" },
  Referral: { icon: UserPlus, className: "text-blue-500" },
  Marketplace: { icon: Store, className: "text-orange-500" },
};

const SOURCES: LeadSource[] = [
  "WhatsApp",
  "Instagram",
  "TikTok",
  "Referral",
  "Marketplace",
];

function lastContactLabel(daysAgo: number): string {
  return daysAgo <= 0 ? "Hari ini" : `${daysAgo} hari lalu`;
}

export function PipelineClient({ leads: LEADS, templates }: { leads: Lead[]; templates: WaTemplate[] }) {
  const leadWaHref = (lead: Lead): string => {
    const msg = fillTemplate(templates[0]?.body ?? "", {
      nama: lead.name,
      produk: "",
      no_pesanan: "",
      total: "",
      toko: STORE_NAME,
    });
    return waLink(lead.phone, msg);
  };
  const active = LEADS.filter(
    (l) => l.stage !== "menang" && l.stage !== "kalah",
  );
  const activeValue = active.reduce((sum, l) => sum + l.value_idr, 0);
  const wonCount = LEADS.filter((l) => l.stage === "menang").length;
  const lostCount = LEADS.filter((l) => l.stage === "kalah").length;
  const closingRate =
    wonCount + lostCount > 0
      ? Math.round((wonCount / (wonCount + lostCount)) * 100)
      : 0;

  return (
    <div>
      <PageHeader
        title="Pipeline"
        desc="Pantau prospek dari chat pertama sampai closing."
      >
        <AddLeadDialog />
      </PageHeader>

      {/* Summary strip */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryStat label="Prospek aktif" value={String(active.length)} />
        <SummaryStat
          label="Nilai pipeline"
          value={IDR(activeValue, { compact: true })}
        />
        <SummaryStat label="Menang" value={String(wonCount)} />
        <SummaryStat label="Tingkat closing" value={`${closingRate}%`} />
      </div>

      {/* Kanban board */}
      <div className="-mx-1 flex gap-4 overflow-x-auto px-1 pb-2">
        {COLUMNS.map((col) => {
          const leads = LEADS.filter((l) => l.stage === col.stage);
          const total = leads.reduce((sum, l) => sum + l.value_idr, 0);
          return (
            <div key={col.stage} className="flex min-w-[260px] flex-1 flex-col">
              <div className="overflow-hidden rounded-t-xl">
                <div className={`h-1 w-full ${col.accent}`} />
              </div>
              <div className="flex items-center justify-between gap-2 rounded-b-none border-x border-t bg-muted/40 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{col.title}</span>
                  <Badge variant="secondary">{leads.length}</Badge>
                </div>
                <span className="text-xs font-medium tabular-nums text-muted-foreground">
                  {IDR(total, { compact: true })}
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-3 rounded-b-xl border-x border-b bg-muted/20 p-3">
                {leads.length === 0 ? (
                  <p className="py-6 text-center text-xs text-muted-foreground">
                    Belum ada prospek
                  </p>
                ) : (
                  leads.map((lead) => <LeadCard key={lead.id} lead={lead} waHref={leadWaHref(lead)} />)
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="py-0">
      <CardContent className="px-4 py-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-xl font-bold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

function LeadCard({ lead, waHref }: { lead: Lead; waHref: string }) {
  const { icon: SourceIcon, className: sourceClass } = SOURCE_META[lead.source];
  return (
    <Card className="gap-0 py-0 shadow-xs transition-shadow hover:shadow-md">
      <CardContent className="flex flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="font-medium leading-tight">{lead.name}</p>
          <Badge variant="outline" className="gap-1 font-normal">
            <SourceIcon className={`size-3 ${sourceClass}`} />
            {lead.source}
          </Badge>
        </div>

        <p className="text-sm font-semibold tabular-nums">
          {IDR(lead.value_idr)}
        </p>

        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="size-3" />
          Terakhir kontak: {lastContactLabel(lead.lastContactDaysAgo)}
        </p>

        {lead.note && (
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {lead.note}
          </p>
        )}

        <div className="mt-1 flex items-center justify-between gap-2">
          <Button
            size="xs"
            nativeButton={false}
            className="bg-emerald-600 text-white hover:bg-emerald-700"
            render={
              <a
                href={waHref}
                target="_blank"
                rel="noopener noreferrer"
              />
            }
          >
            <Send />
            WA
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon-xs" aria-label="Aksi prospek">
                  <MoreHorizontal />
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuItem>Pindah tahap</DropdownMenuItem>
              <DropdownMenuItem>Lihat</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive">Hapus</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  );
}

function AddLeadDialog() {
  const [open, setOpen] = React.useState(false);
  const [source, setSource] = React.useState<LeadSource>("WhatsApp");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button>
            <Plus />
            Tambah prospek
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Tambah prospek</DialogTitle>
          <DialogDescription>
            Catat prospek baru dari chat, DM, atau referral.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="lead-nama">Nama</Label>
            <Input id="lead-nama" placeholder="mis. Rina Wijaya" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="lead-wa">Nomor WhatsApp</Label>
            <Input
              id="lead-wa"
              inputMode="numeric"
              placeholder="mis. 6281234567890"
            />
          </div>
          <div className="grid gap-2">
            <Label>Sumber</Label>
            <div className="flex flex-wrap gap-1.5">
              {SOURCES.map((s) => {
                const { icon: Icon, className } = SOURCE_META[s];
                const selected = s === source;
                return (
                  <Button
                    key={s}
                    type="button"
                    size="sm"
                    variant={selected ? "secondary" : "outline"}
                    onClick={() => setSource(s)}
                  >
                    <Icon className={`size-3.5 ${className}`} />
                    {s}
                  </Button>
                );
              })}
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="lead-nilai">Estimasi nilai</Label>
            <Input
              id="lead-nilai"
              inputMode="numeric"
              placeholder="mis. 450000"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="lead-catatan">Catatan</Label>
            <Textarea
              id="lead-catatan"
              placeholder="mis. Tanya stok kaos ukuran XL"
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline">Batal</Button>} />
          <Button onClick={() => setOpen(false)}>Simpan</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
