"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ColorPalette } from "@tokophi/sections";
import { savePalette, deletePalette, type PaletteInput } from "@/lib/actions/theme";
import { useCan } from "@/components/admin/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Palette as PaletteIcon, Pencil, Trash2, Plus } from "lucide-react";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const ROLES: { key: keyof PaletteInput; label: string }[] = [
  { key: "background", label: "Latar Belakang" },
  { key: "text", label: "Teks" },
  { key: "button", label: "Latar Tombol" },
  { key: "buttonText", label: "Teks Tombol" },
  { key: "accent", label: "Aksen" },
];

const BLANK: PaletteInput = {
  name: "",
  background: "#FFFFFF",
  text: "#18181B",
  button: "#18181B",
  buttonText: "#FFFFFF",
  accent: "#18181B",
};

function Swatch({ hex }: { hex: string }) {
  return <span className="inline-block size-5 rounded-full ring-1 ring-black/10" style={{ backgroundColor: hex }} />;
}

// "Palet Warna" manager (ADR 0009 amendment 2) — list + add/edit form in one dialog, reusing
// the store's saved palettes so every section's colour picker stays in sync automatically
// (this dialog and the per-section picker read the same server-fetched list via a page refresh
// on save — no separate client-side cache to keep consistent).
export function PaletteManagerDialog({ palettes }: { palettes: ColorPalette[] }) {
  const canWrite = useCan("theme:write");
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<PaletteInput | null>(null);
  const [pending, startTransition] = React.useTransition();

  const startAdd = () => setEditing({ ...BLANK });
  const startEdit = (p: ColorPalette) => setEditing({ ...p });

  const handleSave = () => {
    if (!canWrite) {
      toast.error("Akses ditolak — peran Anda tidak bisa mengubah tema toko");
      return;
    }
    if (!editing) return;
    if (!editing.name.trim()) {
      toast.error("Nama palet wajib diisi");
      return;
    }
    for (const { key, label } of ROLES) {
      if (!HEX_RE.test(editing[key] as string)) {
        toast.error(`Warna ${label} tidak valid`);
        return;
      }
    }
    startTransition(async () => {
      try {
        await savePalette(editing);
        toast.success("Palet tersimpan");
        setEditing(null);
        router.refresh();
      } catch {
        toast.error("Gagal menyimpan palet");
      }
    });
  };

  const handleDelete = (id: string) => {
    if (!canWrite) {
      toast.error("Akses ditolak — peran Anda tidak bisa mengubah tema toko");
      return;
    }
    startTransition(async () => {
      try {
        await deletePalette(id);
        toast.success("Palet dihapus");
        router.refresh();
      } catch {
        toast.error("Gagal menghapus palet");
      }
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setEditing(null);
      }}
    >
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm">
            <PaletteIcon data-icon="inline-start" />
            Kelola Palet
          </Button>
        }
      />
      <DialogContent>
        {editing ? (
          <>
            <DialogHeader>
              <DialogTitle>{editing.id ? "Ubah Palet" : "Palet Baru"}</DialogTitle>
              <DialogDescription>5 warna dasar — dipakai section yang memilih palet ini.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Nama Palet</Label>
                <Input
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder="mis. Terang, Gelap, Promo"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                {ROLES.map(({ key, label }) => (
                  <div key={key} className="space-y-1.5">
                    <Label>{label}</Label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={editing[key] as string}
                        onChange={(e) => setEditing({ ...editing, [key]: e.target.value })}
                        className="h-9 w-11 cursor-pointer rounded-lg border border-input bg-transparent p-1"
                      />
                      <Input
                        value={editing[key] as string}
                        onChange={(e) => setEditing({ ...editing, [key]: e.target.value })}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditing(null)}>
                Batal
              </Button>
              <Button onClick={handleSave} disabled={pending}>
                {pending ? "Menyimpan…" : "Simpan Palet"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Kelola Palet Warna</DialogTitle>
              <DialogDescription>
                Buat beberapa palet, lalu pilih palet mana yang dipakai tiap section di builder.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              {palettes.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div className="flex items-center gap-3">
                    <div className="flex -space-x-1">
                      <Swatch hex={p.background} />
                      <Swatch hex={p.text} />
                      <Swatch hex={p.button} />
                      <Swatch hex={p.accent} />
                    </div>
                    <span className="text-sm font-medium">{p.name}</span>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon-sm" onClick={() => startEdit(p)}>
                      <Pencil />
                    </Button>
                    <Button variant="ghost" size="icon-sm" onClick={() => handleDelete(p.id)} disabled={pending}>
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              ))}
              {palettes.length === 0 && <p className="text-sm text-muted-foreground">Belum ada palet.</p>}
            </div>
            <DialogFooter>
              <DialogClose render={<Button variant="outline">Tutup</Button>} />
              <Button onClick={startAdd}>
                <Plus data-icon="inline-start" />
                Palet Baru
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
