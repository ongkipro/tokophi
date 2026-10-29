"use client";
import * as React from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@tokophi/ui/pagination";
import { UploadCloud, Copy, Trash2, ImageIcon } from "lucide-react";
import { uploadMedia, deleteMedia, type MediaItem } from "@/lib/actions/media";
import { useCan } from "@/components/admin/permissions";

const MAX = 2 * 1024 * 1024;
const kb = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

export function FilesClient({ media, total, page, pageSize }: { media: MediaItem[]; total: number; page: number; pageSize: number }) {
  const router = useRouter();
  const canWrite = useCan("media:write");
  const [pending, start] = React.useTransition();
  const [drag, setDrag] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const upload = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    for (const f of list) {
      if (!f.type.startsWith("image/")) { toast.error(`${f.name}: bukan gambar.`); continue; }
      if (f.size > MAX) { toast.error(`${f.name}: melebihi 2MB (${(f.size / 1048576).toFixed(1)}MB).`); continue; }
      const fd = new FormData();
      fd.append("file", f);
      start(async () => {
        const r = await uploadMedia(fd);
        // Newest first: a fresh upload lives on page 1, so go there to show it.
        if (r.ok) { toast.success(`${f.name} diunggah (WebP).`); router.push("/files"); router.refresh(); }
        else toast.error(r.error ?? "Gagal mengunggah.");
      });
    }
  };
  const del = (m: MediaItem) =>
    start(async () => {
      const r = await deleteMedia(m.id);
      if (r.ok) toast.success("File dihapus.");
      else toast.error(r.error ?? "Gagal menghapus file.");
      router.refresh(); // either way: on a refusal this is what clears the row that is already gone
    });
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const go = (p: number) => router.push(p <= 1 ? "/files" : `/files?page=${p}`);
  const copy = (url: string) => { navigator.clipboard?.writeText(url); toast.success("URL disalin."); };

  return (
    <div className="space-y-4">
      {canWrite && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); }}
          className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-colors ${drag ? "border-primary bg-primary/5" : "border-border"}`}
        >
          {/* The busy state matters more here than anywhere else in the app: this is the only dropzone,
              it takes MULTIPLE files, and the conversion runs server-side. Without it a merchant drops
              five photos, sees the page sit still, and drops them again. */}
          <UploadCloud className={`size-8 text-muted-foreground ${pending ? "animate-pulse" : ""}`} />
          <div className="text-sm">
            {pending ? (
              <span className="font-medium text-muted-foreground">Mengunggah…</span>
            ) : (
              <>
                <button type="button" className="font-medium text-primary hover:underline" onClick={() => inputRef.current?.click()}>Pilih gambar</button>{" "}atau seret ke sini
              </>
            )}
          </div>
          {/* "dikonversi ke WebP" is the honest description: PNG/JPG/GIF become WebP, an oversized or
              wastefully-encoded WebP is re-encoded only when that genuinely makes it smaller, and SVG is
              stored untouched (rasterising a vector would make it bigger AND blurry). */}
          <p className="text-xs text-muted-foreground">JPG, PNG, WebP, SVG · <span className="font-medium">maks 2MB</span> · dikonversi ke WebP otomatis (SVG tetap SVG)</p>
          <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
        </div>
      )}

      {media.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 py-14 text-center text-muted-foreground">
          <ImageIcon className="size-8" /><p className="text-sm">Belum ada file. Unggah gambar pertama Anda.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {media.map((m) => (
            <Card key={m.id} className="group gap-0 overflow-hidden p-0">
              <div className="relative aspect-square bg-muted">
                <Image src={m.url} alt={m.filename} fill sizes="200px" className="object-contain" unoptimized />
                <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button size="icon-sm" variant="secondary" aria-label="Salin URL" onClick={() => copy(m.url)}><Copy className="size-4" /></Button>
                  {canWrite && <Button size="icon-sm" variant="secondary" className="text-destructive" aria-label="Hapus" disabled={pending} onClick={() => del(m)}><Trash2 className="size-4" /></Button>}
                </div>
              </div>
              <div className="p-2">
                <div className="truncate text-xs font-medium" title={m.filename}>{m.filename}</div>
                <div className="text-[11px] text-muted-foreground">{kb(m.sizeBytes)}{m.width ? ` · ${m.width}×${m.height}` : ""}</div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {total > pageSize && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Menampilkan{" "}
            <span className="font-medium tabular-nums text-foreground">{(page - 1) * pageSize + 1}–{(page - 1) * pageSize + media.length}</span>{" "}
            dari <span className="font-medium tabular-nums text-foreground">{total}</span> file
          </p>
          <Pagination className="mx-0 w-auto justify-end">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious text="Sebelumnya" aria-disabled={page === 1} className={page === 1 ? "pointer-events-none opacity-50" : undefined} onClick={() => go(page - 1)} />
              </PaginationItem>
              {Array.from({ length: pageCount }, (_, i) => i + 1)
                .filter((p) => p === 1 || p === pageCount || Math.abs(p - page) <= 1)
                .map((p, idx, arr) => (
                  <PaginationItem key={p}>
                    {idx > 0 && arr[idx - 1] !== p - 1 && <span className="px-1 text-muted-foreground">…</span>}
                    <PaginationLink isActive={p === page} onClick={() => go(p)}>{p}</PaginationLink>
                  </PaginationItem>
                ))}
              <PaginationItem>
                <PaginationNext text="Berikutnya" aria-disabled={page === pageCount} className={page === pageCount ? "pointer-events-none opacity-50" : undefined} onClick={() => go(page + 1)} />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}
    </div>
  );
}
