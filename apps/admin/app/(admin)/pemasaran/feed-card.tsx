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

export function FeedCard({ feed }: { feed: FeedStatus }) {
  const [copied, setCopied] = React.useState(false);
  const unclassified = Math.max(0, feed.total - feed.classified);
  const pct = feed.total ? Math.round((feed.classified / feed.total) * 100) : 0;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(feed.feedUrl);
      setCopied(true);
      toast.success("URL feed disalin");
      setTimeout(() => setCopied(false), 1500);
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
            <h3 className="text-sm font-semibold">Feed Produk (Katalog Iklan)</h3>
            <p className="text-xs text-muted-foreground">
              Pasang URL ini di Google Merchant Center, Meta Commerce, atau TikTok agar seluruh produk tampil di iklan katalog. Diperbarui otomatis.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2">
          <code className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={feed.feedUrl}>{feed.feedUrl}</code>
          <Button type="button" variant="ghost" size="sm" onClick={copy}>
            {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />} Salin
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" nativeButton={false} render={<a href={feed.feedUrl} target="_blank" rel="noopener noreferrer" />} aria-label="Buka feed">
            <ExternalLink className="size-4" />
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
          <span className="inline-flex items-center gap-1.5">
            <ShoppingBag className="size-3.5 text-muted-foreground" /> {num(feed.total)} produk
          </span>
          <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
            <Sparkles className="size-3.5" /> {num(feed.classified)} siap feed ({pct}%)
          </span>
          {unclassified > 0 && (
            <Link href="/produk" className="inline-flex items-center gap-1.5 text-amber-600 hover:underline dark:text-amber-400">
              <TriangleAlert className="size-3.5" /> {num(unclassified)} perlu kategori Google
            </Link>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
