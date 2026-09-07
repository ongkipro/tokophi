"use client";

import { Loader2 } from "lucide-react";

import { Button } from "@tokophi/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@tokophi/ui/dialog";

/**
 * The ONE confirm step in front of a destructive list action. Six list screens used to delete
 * straight from a `DropdownMenuItem onClick` — one mis-tap on a phone and the row was gone, with the
 * toast as the only record (TASKS.md Epic 1: "no silent destructive clicks").
 *
 * Mount it as a SIBLING of the `DropdownMenu`, never inside it: a Base UI Dialog rendered inside a
 * menu unmounts together with the menu when the item is clicked (the note in
 * `pembelian-client.tsx`). The menu item only flips `open`; the action runs from `onConfirm`, and the
 * caller closes the dialog when the transition settles so the spinner is visible while it runs.
 *
 * `description` must say what actually happens — "dihapus permanen" or "diarsipkan" — read off the
 * server action, not off the button label. `apps/admin/lib/no-silent-delete.test.ts` pins that every
 * list's delete action is reached only through `onConfirm`, never from an `onClick`.
 */
export function ConfirmDelete({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Ya, hapus",
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={pending}>Batal</Button>} />
          <Button variant="destructive" onClick={onConfirm} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />} {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
