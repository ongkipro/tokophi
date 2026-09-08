"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setReviewStatus, deleteReview, replyToReview } from "@/lib/actions/reviews";
import {
  Star,
  MoreHorizontal,
  Check,
  EyeOff,
  MessageSquare,Trash2,
  Clock,
} from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { EmptyState } from "@/components/admin/empty-state";
import { ConfirmDelete } from "@/components/admin/confirm-delete";
import { Card } from "@tokophi/ui/card";
import { Badge } from "@tokophi/ui/badge";
import { Button } from "@tokophi/ui/button";
import { Label } from "@tokophi/ui/label";
import { Textarea } from "@tokophi/ui/textarea";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@tokophi/ui/dialog";
import { Separator } from "@tokophi/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@tokophi/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@tokophi/ui/dropdown-menu";
import { type Review, type ReviewStatus } from "@/lib/mock/store";
import { num } from "@tokophi/lib/format";
import { cn } from "@tokophi/ui/lib/utils";
import { SearchInput } from "@/components/admin/search-input";

// Render a 1..5 rating as filled/empty stars.
function Stars({
  rating,
  className,
}: {
  rating: number;
  className?: string;
}) {
  return (
    <div
      className={cn("flex items-center gap-0.5", className)}
      aria-label={`${rating} dari 5 bintang`}
    >
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={cn(
            "size-3.5",
            i < rating
              ? "fill-amber-400 text-amber-400"
              : "fill-transparent text-muted-foreground/30",
          )}
        />
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: ReviewStatus }) {
  if (status === "terbit") {
    return (
      <Badge className="border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
        <Check className="size-3!" /> Terbit
      </Badge>
    );
  }
  return (
    <Badge className="border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400">
      <Clock className="size-3!" /> Menunggu
    </Badge>
  );
}

type TabKey = "semua" | ReviewStatus;

const STATUS_TABS: Array<{ key: TabKey; label: string }> = [
  { key: "semua", label: "Semua" },
  { key: "terbit", label: "Terbit" },
  { key: "menunggu", label: "Menunggu" },
];

export function UlasanClient({ reviews }: { reviews: Review[] }) {
  const [tab, setTab] = useState<TabKey>("semua");
  const [query, setQuery] = useState("");

  const avg =
    reviews.reduce((a, r) => a + r.rating, 0) / Math.max(1, reviews.length);
  const avgLabel = avg.toFixed(1).replace(".", ",");
  const menungguCount = reviews.filter((r) => r.status === "menunggu").length;

  // ⚠️ `reviews` belongs in both deps lists below. `router.refresh()` re-renders with fresh server
  // props WITHOUT remounting, so a memo keyed only on local filter state keeps rendering a review
  // that has already been deleted server-side.
  const counts = useMemo(() => {
    return {
      semua: reviews.length,
      terbit: reviews.filter((r) => r.status === "terbit").length,
      menunggu: menungguCount,
    } satisfies Record<TabKey, number>;
  }, [reviews, menungguCount]);

  const rows = useMemo(() => {
    let list = reviews.slice();
    if (tab !== "semua") list = list.filter((r) => r.status === tab);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (r) =>
          r.customer.toLowerCase().includes(q) ||
          r.product.toLowerCase().includes(q) ||
          r.text.toLowerCase().includes(q),
      );
    }
    return list;
  }, [tab, query, reviews]);

  return (
    <div className="mx-auto max-w-[1100px] space-y-5">
      <PageHeader
        title="Ulasan"
        desc="Kelola ulasan produk dari pelanggan Anda."
      />

      {/* stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="gap-0 p-5">
          <span className="text-sm font-medium text-muted-foreground">
            Rating rata-rata
          </span>
          <div className="mt-3 flex items-end gap-2.5">
            <span className="text-2xl font-bold tracking-tight tabular-nums">
              {avgLabel}
            </span>
            <Stars rating={Math.round(avg)} className="mb-1.5" />
          </div>
          <div className="mt-1 text-xs text-muted-foreground tabular-nums">
            dari {num(reviews.length)} ulasan
          </div>
        </Card>

        <Card className="gap-0 p-5">
          <span className="text-sm font-medium text-muted-foreground">
            Total ulasan
          </span>
          <div className="mt-3 text-2xl font-bold tracking-tight tabular-nums">
            {num(reviews.length)}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            seluruh produk
          </div>
        </Card>

        <Card className="gap-0 p-5">
          <span className="text-sm font-medium text-muted-foreground">
            Menunggu moderasi
          </span>
          <div className="mt-3 text-2xl font-bold tracking-tight text-amber-600 tabular-nums dark:text-amber-400">
            {num(menungguCount)}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            perlu ditinjau
          </div>
        </Card>
      </div>

      <Card className="gap-0 py-0">
        {/* tabs + search */}
        <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
          <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
            <TabsList>
              {STATUS_TABS.map((t) => (
                <TabsTrigger key={t.key} value={t.key} className="gap-1.5">
                  {t.label}
                  <span className="rounded-full bg-muted-foreground/15 px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                    {counts[t.key]}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <SearchInput
            label="Cari ulasan"
            value={query}
            onValueChange={setQuery}
            placeholder="Cari pelanggan, produk, atau isi ulasan…"
            inputClassName="h-8 w-full lg:w-72"
          />
        </div>

        <Separator />

        {/* review list */}
        <div>
          {rows.map((r, i) => (
            <div key={r.id}>
              {i > 0 && <Separator />}
              <ReviewRow review={r} />
            </div>
          ))}
          {/* A store that has never had a review used to be told its SEARCH missed — advice about a
              filter nobody set. There is deliberately no CTA on the `kosong` arm: nothing the seller
              can press makes a review appear, and a button that cannot work is worse than none. */}
          {rows.length === 0 &&
            (reviews.length === 0 ? (
              <EmptyState
                icon={Star}
                title="Belum ada ulasan"
                desc="Ulasan muncul di sini setelah pembeli menilai produk yang sudah mereka terima."
              />
            ) : (
              <EmptyState
                kind="filter"
                title="Tidak ada ulasan yang cocok"
                desc="Tidak ada ulasan pada tab dan kata kunci ini."
                action={{
                  label: "Hapus filter",
                  onClick: () => {
                    setTab("semua");
                    setQuery("");
                  },
                }}
              />
            ))}
        </div>

        {rows.length > 0 && (
          <>
            <Separator />
            {/* Rewritten by the filter tabs and the search box, i.e. by typing. */}
            <div className="p-4 text-xs text-muted-foreground tabular-nums">
              Menampilkan {num(rows.length)} ulasan
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

function ReviewRow({ review: r }: { review: Review }) {
  return (
    <div className="flex gap-4 p-4 sm:p-5">
      {/* product emoji tile */}
      <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted text-xl">
        {r.emoji}
      </div>

      {/* main */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="font-medium">{r.customer}</div>
            <div className="line-clamp-2 whitespace-normal break-words text-xs text-muted-foreground" title={r.product}>
              membeli {r.product}
            </div>
          </div>

          {/* right meta */}
          <div className="flex shrink-0 items-center gap-2">
            <StatusBadge status={r.status} />
            <span className="hidden text-xs text-muted-foreground tabular-nums sm:inline">
              {num(r.daysAgo)} hari lalu
            </span>
            <ReviewActions id={r.id} status={r.status} reply={r.reply} />
          </div>
        </div>

        <div className="mt-2">
          <Stars rating={r.rating} />
        </div>

        <p className="mt-2 text-sm leading-relaxed text-foreground/90">
          {r.text}
        </p>

        {r.reply && (
          <div className="mt-3 rounded-lg border-l-2 border-primary/40 bg-muted/40 px-3 py-2">
            <p className="text-xs font-medium text-muted-foreground">Balasan Anda</p>
            <p className="mt-1 text-sm leading-relaxed text-foreground/90">{r.reply}</p>
          </div>
        )}

        <span className="mt-2 block text-xs text-muted-foreground tabular-nums sm:hidden">
          {num(r.daysAgo)} hari lalu
        </span>
      </div>
    </div>
  );
}

function ReviewActions({ id, status, reply = "" }: { id: string; status: ReviewStatus; reply?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [replyOpen, setReplyOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const run = (fn: () => Promise<{ ok: boolean }>, msg: string) =>
    start(async () => {
      try {
        const r = await fn();
        if (!r.ok) throw new Error();
        toast.success(msg);
        router.refresh();
      } catch {
        toast.error("Gagal — coba lagi.");
      }
    });
  // Closes the confirm when the delete settles either way; `run` owns the toasts.
  const del = () => run(() => deleteReview(id).finally(() => setConfirmOpen(false)), "Ulasan dihapus.");
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon-sm" aria-label="Aksi ulasan">
              <MoreHorizontal className="size-4" />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          {status === "menunggu" ? (
            <DropdownMenuItem disabled={pending} onClick={() => run(() => setReviewStatus(id, "terbit"), "Ulasan diterbitkan.")}>
              <Check className="size-4" /> Terbitkan
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem disabled={pending} onClick={() => run(() => setReviewStatus(id, "menunggu"), "Ulasan disembunyikan.")}>
              <EyeOff className="size-4" /> Sembunyikan
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => setReplyOpen(true)}>
            <MessageSquare className="size-4" /> {reply ? "Edit balasan" : "Balas"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" disabled={pending} onClick={() => setConfirmOpen(true)}>
            <Trash2 className="size-4" /> Hapus
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {replyOpen && <ReplyDialog id={id} reply={reply} onOpenChange={setReplyOpen} run={run} />}
      {/* `deleteReview` is a hard DELETE (the seller's reply goes with the row). "Sembunyikan" is the
          reversible alternative, so the copy points at it. */}
      <ConfirmDelete
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Hapus ulasan?"
        description="Ulasan ini beserta balasan Anda dihapus permanen dan tidak bisa dikembalikan. Kalau hanya ingin menyembunyikannya dari toko, pakai 'Sembunyikan'."
        onConfirm={del}
        pending={pending}
      />
    </>
  );
}

// Mounted only while open, so the textarea seeds fresh from the saved reply each time.
function ReplyDialog({
  id, reply, onOpenChange, run,
}: {
  id: string; reply: string; onOpenChange: (o: boolean) => void;
  run: (fn: () => Promise<{ ok: boolean }>, msg: string) => void;
}) {
  const [text, setText] = useState(reply);
  const save = () => {
    run(() => replyToReview(id, text), text.trim() ? "Balasan disimpan." : "Balasan dihapus.");
    onOpenChange(false);
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Balas ulasan</DialogTitle>
          <DialogDescription>
            Balasan tampil publik di halaman produk, di bawah ulasan ini — hanya bila ulasan berstatus terbit.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="review-reply">Balasan penjual</Label>
          <Textarea
            id="review-reply"
            className="min-h-28"
            placeholder="mis. Terima kasih kak atas ulasannya! 🙏"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">Kosongkan lalu simpan untuk menghapus balasan.</p>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline">Tutup</Button>} />
          <Button onClick={save}>Simpan</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
