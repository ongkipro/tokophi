"use client";

import * as React from "react";
import { Check, ChevronDown } from "lucide-react";

import type { NavItem, NavItemType } from "@/lib/mock/store";
import { TYPE_META, TYPE_OPTIONS, TARGET_PLACEHOLDER } from "./nav-meta";

import { Button } from "@tokophi/ui/button";
import { Input } from "@tokophi/ui/input";
import { Label } from "@tokophi/ui/label";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@tokophi/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@tokophi/ui/dropdown-menu";

export type ItemDraft = { title: string; type: NavItemType; target: string };

export function ItemFormDialog({
  open,
  onOpenChange,
  initial,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: NavItem | null;
  onSubmit: (draft: ItemDraft) => void;
}) {
  const isEdit = Boolean(initial);
  const [title, setTitle] = React.useState("");
  const [type, setType] = React.useState<NavItemType>("koleksi");
  const [target, setTarget] = React.useState("");

  // Reseed the form whenever the dialog opens (add = blank, edit = current values) — during render,
  // the same [open, initial] Object.is comparison the effect had, minus the post-paint setState
  // cascade (react-hooks/set-state-in-effect): the old version painted one frame of stale fields.
  const [prevSeed, setPrevSeed] = React.useState<readonly [boolean, typeof initial]>([open, initial]);
  if (!Object.is(prevSeed[0], open) || !Object.is(prevSeed[1], initial)) {
    setPrevSeed([open, initial]);
    if (open) {
      setTitle(initial?.title ?? "");
      setType(initial?.type ?? "koleksi");
      setTarget(initial?.target ?? "");
    }
  }

  const canSave = title.trim().length > 0;

  function handleSave() {
    if (!canSave) return;
    onSubmit({ title: title.trim(), type, target: target.trim() });
    onOpenChange(false);
  }

  const TypeIcon = TYPE_META[type].icon;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit item menu" : "Tambah item menu"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Ubah nama, tujuan, atau jenis tautan item ini."
              : "Tambahkan tautan baru ke menu yang dipilih."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-1">
          <div className="flex flex-col gap-2">
            <Label htmlFor="nav-item-nama">Nama</Label>
            <Input
              id="nav-item-nama"
              placeholder="mis. Koleksi Terbaru"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>Tautan ke</Label>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" className="justify-between font-normal">
                    <span className="flex items-center gap-2">
                      <TypeIcon className="size-4 text-muted-foreground" />
                      {TYPE_META[type].label}
                    </span>
                    <ChevronDown className="text-muted-foreground" />
                  </Button>
                }
              />
              <DropdownMenuContent className="w-(--anchor-width)">
                {TYPE_OPTIONS.map((t) => {
                  const Icon = TYPE_META[t].icon;
                  return (
                    <DropdownMenuItem key={t} onClick={() => setType(t)}>
                      <Icon className="text-muted-foreground" />
                      <span className="flex-1">{TYPE_META[t].label}</span>
                      {t === type && <Check className="size-4 text-emerald-500" />}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="nav-item-target">Tujuan / URL</Label>
            <Input
              id="nav-item-target"
              className="font-mono text-[0.8rem]"
              placeholder={TARGET_PLACEHOLDER[type]}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline">Batal</Button>} />
          <Button onClick={handleSave} disabled={!canSave}>
            {isEdit ? "Simpan perubahan" : "Tambah item"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
