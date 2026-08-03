"use client";
// "Katalog Iklan" — surfaces the always-on product feed URL (ADR 0011) so the merchant can actually
// paste it into Google Merchant / Meta Commerce / TikTok. A feed no one can find is a dead feature.
import * as React from "react";
import Link from "next/link";
import { Rss, Copy, Check, ExternalLink, ShoppingBag, Sparkles, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { num } from "@tokophi/lib/format";
import type { FeedStatus } from "@/lib/data/feed";
import { Card, CardContent } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { switchToStableCatalogIds } from "@/lib/actions/tracking";
import { useCan } from "@/components/admin/permissions";
import { useRouter } from "next/navigation";

function FeedRow({ label, url, copied, onCopy }: { label: string; url: string; copied: boolean; onCopy: () => void }) {
  if (!url) return null;
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2">
      <span className="shrink-0 text-xs font-medium text-muted-foreground">{label}</span>
      <code className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={url}>{url}</code>
      <Button type="button" variant="ghost" size="sm" onClick={onCopy}>
        {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />} Salin
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" nativeButton={false} render={<a href={url} target="_blank" rel="noopener noreferrer" />} aria-label={`Buka feed ${label}`}>
        <ExternalLink className="size-4" />
      </Button>
    </div>
  );
}

/**
 * ADR 0013 — which id this store publishes, and the one-way switch to the stable scheme.
 *
 * The warning is not decoration. Google overwrites the product and its history when an id changes,
 * Meta deletes and recreates the catalog item, and any retargeting audience keyed on the old
 * `content_ids` stops matching. No provider offers a re-key, so this is the merchant's call, made once,
 * ideally when little is being spent.
 */
function CatalogIdSection({ scheme, published }: { scheme: string; published: number }) {
  const canWrite = useCan("integrations:write");
  const router = useRouter();
  const [busy, start] = React.useTransition();
  const [confirming, setConfirming] = React.useState(false);

  if (scheme === "number") {
    return (
      <p className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        ID produk di feed memakai <span className="font-medium text-foreground">penomoran tetap</span> (mis.
        <code className="mx-1">1042-3</code>) — tidak berubah walau nama produk, urutan, atau jumlah varian diubah.
      </p>
    );
  }

  // Nothing is published yet, so there is no catalogue anywhere to re-key. Showing an irreversible
  // warning to a merchant who has not listed a product is pure noise on the page they came to set up ads.
  if (published === 0) return null;

  const switchNow = () =>
    start(async () => {
      const r = await switchToStableCatalogIds();
      if (r.ok) { toast.success("ID katalog dipindah ke penomoran tetap."); router.refresh(); }
      else toast.error(r.error ?? "Gagal memindah skema.");
    });

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
      <p className="text-xs font-medium">Sebaiknya pindah ke ID produk tetap</p>
      <p className="mt-1 text-xs text-muted-foreground">
        ID produk di feed ini masih diambil dari nama handle, jadi <span className="font-medium text-foreground">ikut berubah</span>{" "}
        setiap Anda mengganti nama produk, menggeser urutan varian, atau menambah varian kedua —
        dan Google, Meta, serta TikTok membaca ID yang berubah sebagai &quot;produk lama dihapus, produk baru
        muncul&quot;. Penomoran tetap (mis. <code className="mx-0.5">1042-3</code>) tidak pernah berubah.
      </p>
      {/* The decision the merchant is actually being asked to make — they are the only one who knows
          whether this feed URL has been pasted anywhere yet, and that single fact decides the answer. */}
      <p className="mt-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Belum pernah menghubungkan feed ini</span> ke Merchant
        Center / Commerce Manager / TikTok? Pindah sekarang — tidak ada yang hilang, dan Anda tidak perlu
        membayar biayanya nanti. <span className="font-medium text-foreground">Sudah terhubung?</span> Pindah tetap
        bisa, tapi katalog lama dianggap produk baru: pilih waktu belanja iklan sedang kecil, lalu minta
        platformnya menarik feed ulang.
      </p>
      {!confirming ? (
        canWrite && (
          <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => setConfirming(true)}>
            Pindah ke penomoran tetap
          </Button>
        )
      ) : (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-muted-foreground">
            Sekali dipindah, <span className="font-medium text-foreground">tidak bisa dikembalikan</span>. Katalog yang
            sudah terlanjur ditarik Google/Meta/TikTok akan dianggap produk baru: riwayat performa produk dan audiens
            retargeting yang memakai ID lama akan ter-reset. Lakukan saat belanja iklan sedang kecil.
          </p>
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={switchNow} disabled={busy}>Ya, pindahkan</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>Batal</Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function FeedCard({ feed }: { feed: FeedStatus }) {
  const [copied, setCopied] = React.useState("");
  const unclassified = Math.max(0, feed.total - feed.classified);
  const missing = feed.notPublishedDraft + feed.notPublishedNoImage;

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      toast.success("URL feed disalin");
      setTimeout(() => setCopied(""), 1500);
    } catch {
      toast.error("Gagal menyalin — salin manual");
    }
  };

  if (!feed.feedUrl) return null;

  return (
    <Card className="mb-4 border-primary/20 bg-primary/[0.03]">
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Rss className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            {/* h2, not h3 — /pemasaran renders no other heading between this and the page `<h1>`,
                so an h3 skipped a level. Tag only; `text-sm` still sets the size. */}
            <h2 className="text-sm font-semibold">Feed Produk (Katalog Iklan)</h2>
            <p className="text-xs text-muted-foreground">
              Pasang URL ini di Google Merchant Center, Meta Commerce, atau TikTok agar seluruh produk tampil di iklan katalog. Diperbarui otomatis.
            </p>
          </div>
        </div>

        {/* Google + Meta share one document (both ingest RSS 2.0 + the `g:` namespace). TikTok gets
            its own: it requires `sku_id` instead of `id` and caps the category at 3 levels, which
            cannot be satisfied inside Google's feed without degrading Google. */}
        <FeedRow label="Google & Meta" url={feed.feedUrl} copied={copied === feed.feedUrl} onCopy={() => copy(feed.feedUrl)} />
        <FeedRow label="TikTok" url={feed.tiktokFeedUrl} copied={copied === feed.tiktokFeedUrl} onCopy={() => copy(feed.tiktokFeedUrl)} />

        <CatalogIdSection scheme={feed.catalogIdScheme} published={feed.total} />

        {/* "22 produk terbit" alone is a number a merchant can read and cannot act on — and next to
            "22 siap feed (100%)" it was the same number twice. What matters is the SHORTFALL and its
            reason: a draft and a photo-less product are both invisible in the feed, for different
            reasons, and both are one click away from being fixed. */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
          <span className="inline-flex items-center gap-1.5">
            <ShoppingBag className="size-3.5 text-muted-foreground" />
            {missing > 0 ? (
              <>
                <span className="font-medium">{num(feed.total)}</span> dari {num(feed.total + missing)} produk terbit di feed
              </>
            ) : (
              <>
                <span className="font-medium">{num(feed.total)}</span> produk terbit di feed
              </>
            )}
          </span>
          {feed.notPublishedDraft > 0 && (
            <Link href="/produk" className="inline-flex items-center gap-1.5 text-muted-foreground hover:underline">
              <TriangleAlert className="size-3.5" /> {num(feed.notPublishedDraft)} masih draf
            </Link>
          )}
          {feed.notPublishedNoImage > 0 && (
            <Link href="/produk" className="inline-flex items-center gap-1.5 text-amber-600 hover:underline dark:text-amber-400">
              <TriangleAlert className="size-3.5" /> {num(feed.notPublishedNoImage)} tanpa foto
            </Link>
          )}
          {unclassified > 0 && (
            <Link href="/produk" className="inline-flex items-center gap-1.5 text-amber-600 hover:underline dark:text-amber-400">
              <TriangleAlert className="size-3.5" /> {num(unclassified)} perlu kategori Google
            </Link>
          )}
          {feed.feedItems > 0 && (
            // Merchant Center counts VARIANTS. Saying only "22 produk" left the merchant staring at
            // "86 items" in Google's UI with nothing on our side to reconcile it against.
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Sparkles className="size-3.5" /> {num(feed.feedItems)} varian dikirim ke platform
            </span>
          )}
          {missing === 0 && unclassified === 0 && feed.total > 0 && (
            <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
              <Sparkles className="size-3.5" /> seluruh katalog siap
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
