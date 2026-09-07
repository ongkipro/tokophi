"use client";

import * as React from "react";
import {
  Users, TrendingUp, TrendingDown, Plus, MoreHorizontal,
  Crown, UserPlus, Sparkles, MapPin, AlertTriangle,
} from "lucide-react";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createSegment, updateSegment, deleteSegment } from "@/lib/actions/segments";
import { PageHeader } from "@/components/admin/page-header";
import { EmptyState } from "@/components/admin/empty-state";
import { ConfirmDelete } from "@/components/admin/confirm-delete";
import { useCan } from "@/components/admin/permissions";
import { num, pct } from "@tokophi/lib/format";
import { type CustSegment } from "@/lib/mock/store";
import { cn } from "@tokophi/ui/lib/utils";

import { Card } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Input } from "@tokophi/ui/input";
import { Label } from "@tokophi/ui/label";
import { Textarea } from "@tokophi/ui/textarea";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@tokophi/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator,
} from "@tokophi/ui/dropdown-menu";

/** Pilih ikon + warna tint berdasarkan nama segmen. */
function segmentVisual(name: string): { Icon: typeof Users; tint: string } {
  const n = name.toLowerCase();
  if (n.includes("vip")) return { Icon: Crown, tint: "bg-amber-100 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400" };
  if (n.includes("loyal")) return { Icon: Sparkles, tint: "bg-violet-100 text-violet-600 dark:bg-violet-950/50 dark:text-violet-400" };
  if (n.includes("baru")) return { Icon: UserPlus, tint: "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400" };
  if (n.includes("belum")) return { Icon: AlertTriangle, tint: "bg-muted text-muted-foreground" };
  if (n.includes("churn") || n.includes("risiko")) return { Icon: TrendingDown, tint: "bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400" };
  if (n.includes("kota")) return { Icon: MapPin, tint: "bg-blue-100 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400" };
  return { Icon: Users, tint: "bg-muted text-muted-foreground" };
}

function SegmentActions({ segment }: { segment: CustSegment }) {
  const router = useRouter();
  const canWrite = useCan("crm:write");
  const [pending, startTransition] = React.useTransition();
  const [editOpen, setEditOpen] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const remove = () =>
    startTransition(async () => {
      try {
        await deleteSegment(segment.id);
        toast.success(`Segmen "${segment.name}" dihapus`);
        router.refresh();
      } catch {
        toast.error("Gagal menghapus segmen");
      } finally {
        setConfirmOpen(false);
      }
    });
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Aksi segmen" />}>
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {/* No segment membership model exists (memberCount is a stored count, not an evaluated rule),
              so there is nothing to list — honest disabled rather than a no-op. */}
          <DropdownMenuItem disabled className="opacity-60"><Users /> Lihat pelanggan<span className="ml-auto text-[10px] text-muted-foreground">segera</span></DropdownMenuItem>
          {canWrite && <DropdownMenuItem onClick={() => setEditOpen(true)}><Sparkles /> Edit</DropdownMenuItem>}
          {canWrite && <DropdownMenuSeparator />}
          {canWrite && <DropdownMenuItem variant="destructive" disabled={pending} onClick={() => setConfirmOpen(true)}><TrendingDown /> Hapus</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
      {editOpen && <EditSegmentDialog segment={segment} onOpenChange={setEditOpen} />}
      {/* `deleteSegment` is a hard DELETE of the segment row only — customers are never touched
          (memberCount is a stored number, not a membership). Say exactly that. */}
      <ConfirmDelete
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Hapus segmen?"
        description={`Segmen "${segment.name}" dihapus permanen. Pelanggan di dalamnya tidak ikut terhapus.`}
        onConfirm={remove}
        pending={pending}
      />
    </>
  );
}

// Mounted only while open, so the fields seed fresh from the segment each time.
function EditSegmentDialog({ segment, onOpenChange }: { segment: CustSegment; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [name, setName] = React.useState(segment.name);
  const [description, setDescription] = React.useState(segment.description);
  const save = () =>
    start(async () => {
      const r = await updateSegment(segment.id, { name, description });
      if (r.ok) { toast.success("Segmen diperbarui."); onOpenChange(false); router.refresh(); }
      else toast.error(r.error ?? "Gagal menyimpan.");
    });
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit segmen</DialogTitle>
          <DialogDescription>Ubah nama dan deskripsi segmen.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="seg-nama">Nama</Label>
            <Input id="seg-nama" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="seg-desc">Deskripsi</Label>
            <Textarea id="seg-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline">Tutup</Button>} />
          <Button disabled={pending || !name.trim()} onClick={save}>{pending ? "Menyimpan…" : "Simpan"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SegmentCard({ segment }: { segment: CustSegment }) {
  const { Icon, tint } = segmentVisual(segment.name);
  const up = segment.growth >= 0;

  return (
    <Card className="gap-3 p-4 transition-shadow hover:shadow-md hover:ring-foreground/15">
      <div className="flex items-start justify-between gap-2">
        <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg", tint)}>
          <Icon className="size-5" />
        </div>
        <SegmentActions segment={segment} />
      </div>

      <div>
        <p className="line-clamp-2 break-words font-medium" title={segment.name}>{segment.name}</p>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-2xl font-bold tabular-nums">{num(segment.count)}</span>
          <span
            className={cn(
              "flex items-center gap-0.5 text-xs font-medium tabular-nums",
              up ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400",
            )}
          >
            {up ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
            {pct(segment.growth)}
          </span>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{segment.description}</p>
    </Card>
  );
}

// Mounted only while open (both the header button and the empty state's CTA open the SAME dialog),
// so the fields reset for free on close.
function CreateSegmentDialog({ onOpenChange }: { onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [desc, setDesc] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const create = () => {
    if (!name.trim()) {
      toast.error("Nama segmen wajib diisi");
      return;
    }
    startTransition(async () => {
      try {
        await createSegment({ name, description: desc });
        toast.success("Segmen dibuat");
        onOpenChange(false);
        router.refresh();
      } catch {
        toast.error("Gagal membuat segmen");
      }
    });
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Buat segmen baru</DialogTitle>
          <DialogDescription>
            Kelompokkan pelanggan agar mudah ditargetkan lewat promo dan kampanye.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-1">
          <div className="grid gap-2">
            <Label htmlFor="segmen-nama">Nama segmen</Label>
            <Input id="segmen-nama" placeholder="mis. Pelanggan Setia" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="segmen-deskripsi">Deskripsi</Label>
            <Textarea id="segmen-deskripsi" placeholder="Jelaskan siapa yang termasuk dalam segmen ini." rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} />
          </div>

          <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
            <span>
              Aturan segmen otomatis (mis. total belanja, jumlah pesanan, lokasi) bisa diatur setelah segmen dibuat —
              pelanggan yang cocok akan masuk dan keluar sendiri.
            </span>
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline">Batal</Button>} />
          <Button onClick={create} disabled={pending}>{pending ? "Menyimpan…" : "Simpan"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SegmenClient({ segments }: { segments: CustSegment[] }) {
  const canWrite = useCan("crm:write");
  const [createOpen, setCreateOpen] = React.useState(false);
  const totalCustomers = segments.reduce((sum, s) => sum + s.count, 0);
  const empty = segments.length === 0;

  return (
    <div>
      <PageHeader title="Segmen" desc="Kelompokkan pelanggan berdasarkan perilaku belanja mereka.">
        {canWrite && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus /> Buat segmen
          </Button>
        )}
      </PageHeader>
      {createOpen && <CreateSegmentDialog onOpenChange={setCreateOpen} />}

      {/* Ringkasan — a strip reading "0 segmen aktif · 0 pelanggan tersegmen" is two zeroes where a
          first-time seller needs a sentence, so it is held back until there is something to count. */}
      {!empty && (
      <div className="mb-4 flex flex-col gap-3 rounded-lg border bg-muted/40 p-3 text-sm sm:flex-row sm:items-center sm:gap-8">
        <p className="flex items-center gap-2">
          <Users className="size-4 shrink-0 text-primary" />
          <span className="text-muted-foreground">
            <span className="font-medium tabular-nums text-foreground">{num(segments.length)}</span> segmen aktif
          </span>
        </p>
        <p className="flex items-center gap-2">
          <TrendingUp className="size-4 shrink-0 text-primary" />
          <span className="text-muted-foreground">
            <span className="font-medium tabular-nums text-foreground">{num(totalCustomers)}</span> pelanggan tersegmen
          </span>
        </p>
      </div>
      )}

      {/* Grid segmen. There is no search or filter on this screen, so `kosong` is the only empty
          state it can reach — and for a staff user the create button does not exist, which is why
          the CTA is swapped for the sentence naming who can make one. */}
      {empty ? (
        <EmptyState
          card
          icon={Users}
          title="Belum ada segmen"
          desc={
            canWrite
              ? "Segmen mengelompokkan pelanggan berdasarkan perilaku belanja, supaya promo dan broadcast WhatsApp bisa ditujukan ke kelompok yang tepat."
              : "Segmen mengelompokkan pelanggan berdasarkan perilaku belanja. Minta Owner atau Admin toko membuat yang pertama."
          }
          action={canWrite ? { label: "Buat segmen", icon: Plus, onClick: () => setCreateOpen(true) } : undefined}
          secondary={{ label: "Lihat pelanggan", href: "/pelanggan" }}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {segments.map((segment) => (
            <SegmentCard key={segment.id} segment={segment} />
          ))}
        </div>
      )}
    </div>
  );
}
