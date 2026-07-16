"use client";
import * as React from "react";
import { toast } from "sonner";
import { Upload, Trash2, Loader2 } from "lucide-react";
import { Button } from "@tokophi/ui/button";
import { Label } from "@tokophi/ui/label";

// One uploader, used for both the logo and the favicon: they differ in RULES (accepted types, preview
// size, help text), not in BEHAVIOUR. Two near-identical copies would drift the day one of them gets
// a fix — the same reasoning that put saveImage in lib/image-store.ts instead of in both actions.
//
// The preview is the point. A merchant uploading a logo is asking one question — "how will it look?" —
// and a filename in a text field does not answer it. It renders on the same surface it will ship on:
// the favicon at 16px in a mock browser tab, because a logo that reads fine at 200px can be an
// unrecognisable smudge at 16.

type Props = {
  label: string;
  hint: string;
  /** Current stored url, or null when unset. */
  value: string | null;
  accept: string;
  disabled?: boolean;
  /** Returns the stored url: the server renames the file and re-encodes it to WebP, so the client
   *  cannot derive the final name and must not guess it. */
  onUpload: (fd: FormData) => Promise<{ ok: true; url: string } | { ok: false; error: string }>;
  onRemove: () => Promise<{ ok: true } | { ok: false; error: string }>;
  onChanged: (url: string | null) => void;
  /** Renders the preview. Logo and favicon look nothing alike at rest. */
  preview: (url: string) => React.ReactNode;
};

export function BrandingUpload({ label, hint, value, accept, disabled, onUpload, onRemove, onChanged, preview }: Props) {
  const input = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);

  const send = async (file: File) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await onUpload(fd);
      if (res.ok) {
        toast.success(`${label} tersimpan.`);
        onChanged(res.url);
      } else {
        toast.error(res.error);
      }
    } catch {
      toast.error(`Gagal mengunggah ${label.toLowerCase()}.`);
    } finally {
      setBusy(false);
      // Always clear: without this, picking the SAME file twice fires no change event and the retry
      // silently does nothing.
      if (input.current) input.current.value = "";
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const res = await onRemove();
      if (res.ok) {
        toast.success(`${label} dihapus.`);
        onChanged(null);
      } else toast.error(res.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <div className="flex flex-wrap items-center gap-3">
        {value ? (
          preview(value)
        ) : (
          <div className="grid size-16 shrink-0 place-items-center rounded-lg border border-dashed text-[10px] text-muted-foreground">
            Belum ada
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <input
            ref={input}
            type="file"
            accept={accept}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void send(f);
            }}
          />
          <Button size="sm" variant="outline" disabled={disabled || busy} onClick={() => input.current?.click()}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
            {value ? "Ganti" : "Unggah"}
          </Button>
          {value && (
            <Button size="sm" variant="ghost" disabled={disabled || busy} onClick={() => void remove()}>
              <Trash2 className="size-3.5" /> Hapus
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
