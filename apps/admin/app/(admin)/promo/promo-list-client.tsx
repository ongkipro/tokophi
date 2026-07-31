"use client";

import * as React from "react";
import Link from "next/link";
import { Rocket, Pencil, ExternalLink, Copy, Check, Code2, Plus } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/admin/page-header";
import { ProductThumb } from "@/components/admin/product-thumb";
import type { PromoListRow } from "@/lib/data/promo";
import type { LandingListRow } from "@/lib/data/landing";

import { Card, CardContent } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Badge } from "@tokophi/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@tokophi/ui/table";

export function PromoListClient({ rows, landings }: { rows: PromoListRow[]; landings: LandingListRow[] }) {
  const [copied, setCopied] = React.useState<string | null>(null);
  const enabledCount = rows.filter((r) => r.enabled).length;

  function copy(url: string, id: string) {
    navigator.clipboard?.writeText(url).then(
      () => {
        setCopied(id);
        toast.success("Link disalin");
        setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500);
      },
      () => toast.error("Gagal menyalin link"),
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Landing Page"
        desc="Ubah satu produk jadi halaman pesanan langsung (COD) — form, ongkir otomatis, dan checkout dalam satu halaman untuk dibagikan lewat iklan."
      />

      <Card>
        <CardContent className="p-0">
          <div className="flex items-center justify-between border-b px-4 py-3 text-sm text-muted-foreground">
            <span>{rows.length} produk</span>
            <span>{enabledCount} halaman promo aktif</span>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produk</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.productId}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <ProductThumb src={r.image ?? undefined} alt={r.name} className="h-10 w-10 shrink-0" />
                      <span className="font-medium">{r.name}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {r.enabled ? (
                      <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Aktif</Badge>
                    ) : (
                      <Badge variant="secondary">Nonaktif</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      {r.enabled && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copy(r.shareUrl, r.productId)}
                            title="Salin link"
                          >
                            {copied === r.productId ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            nativeButton={false}
                            title="Buka halaman"
                            render={<a href={r.shareUrl} target="_blank" rel="noreferrer" />}
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        nativeButton={false}
                        render={<Link href={`/promo/${r.productId}`} />}
                      >
                        <Pencil className="mr-1.5 h-4 w-4" />
                        Atur
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="py-12 text-center text-muted-foreground">
                    <Rocket className="mx-auto mb-2 h-8 w-8 opacity-40" />
                    Belum ada produk aktif untuk dibuat halaman promo.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Landing HTML custom — paste-your-own-HTML landings (/lp/<slug>) */}
      <Card>
        <CardContent className="p-0">
          <div className="flex items-center justify-between gap-4 border-b px-4 py-3">
            <div className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Landing HTML Custom</span> — tempel HTML desain sendiri
            </div>
            <Button size="sm" nativeButton={false} render={<Link href="/promo/html/baru" />}>
              <Plus className="mr-1.5 h-4 w-4" /> Buat baru
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Judul / Slug</TableHead>
                <TableHead>Produk</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {landings.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Code2 className="h-5 w-5 shrink-0 text-muted-foreground" />
                      <div>
                        <div className="font-medium">{l.title}</div>
                        <div className="text-xs text-muted-foreground">/lp/{l.slug}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{l.productName}</TableCell>
                  <TableCell>
                    {l.enabled ? (
                      <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Aktif</Badge>
                    ) : (
                      <Badge variant="secondary">Nonaktif</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      {l.enabled && (
                        <>
                          <Button variant="ghost" size="sm" onClick={() => copy(l.shareUrl, l.id)} title="Salin link">
                            {copied === l.id ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                          </Button>
                          <Button variant="ghost" size="sm" nativeButton={false} title="Buka halaman" render={<a href={l.shareUrl} target="_blank" rel="noreferrer" />}>
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                      <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/promo/html/${l.id}`} />}>
                        <Pencil className="mr-1.5 h-4 w-4" /> Atur
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {landings.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                    <Code2 className="mx-auto mb-2 h-8 w-8 opacity-40" />
                    Belum ada landing HTML. Klik &ldquo;Buat baru&rdquo; untuk menempel HTML kamu.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
