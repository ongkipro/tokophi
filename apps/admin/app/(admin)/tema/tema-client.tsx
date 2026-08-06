"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, LayoutTemplate, MoreHorizontal, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { TemplateAssignment, TemplateSummary, TemplateType } from "@/lib/data/theme";
import {
  assignCollectionTemplate,
  assignProductTemplate,
  assignTemplateBulk,
  createTemplate,
  deleteTemplate,
  renameTemplate,
  setDefaultTemplate,
} from "@/lib/actions/theme";
import { Can, useCan } from "@/components/admin/permissions";
import { PageHeader } from "@/components/admin/page-header";
import { BrandColorDialog } from "@/components/theme/brand-color-dialog";
import { GalleryLayoutDialog } from "@/components/theme/gallery-layout-dialog";
import { Badge } from "@tokophi/ui/badge";
import { Button } from "@tokophi/ui/button";
import { Card, CardContent } from "@tokophi/ui/card";
import { Checkbox } from "@tokophi/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@tokophi/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@tokophi/ui/dropdown-menu";
import { Input } from "@tokophi/ui/input";
import { Label } from "@tokophi/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@tokophi/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@tokophi/ui/tabs";

type Props = {
  templates: TemplateSummary[];
  collections: TemplateAssignment[];
  products: TemplateAssignment[];
  brandColor: string;
  galleryLayout: string;
};

const TABS: { key: TemplateType; label: string; desc: string }[] = [
  {
    key: "homepage",
    label: "Beranda",
    desc: "Halaman depan toko. Template bertanda Default adalah yang tampil di storefront.",
  },
  {
    key: "category",
    label: "Kategori",
    desc: "Variasi tata letak halaman kategori — tetapkan per kategori. Kategori tanpa penetapan memakai template Default.",
  },
  {
    key: "product",
    label: "Produk",
    desc: "Variasi tata letak halaman produk — tetapkan per produk. Produk tanpa penetapan memakai template Default.",
  },
];

const dateFmt = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" });

export function TemaClient({ templates, collections, products, brandColor, galleryLayout }: Props) {
  const canWrite = useCan("theme:write");
  const router = useRouter();
  const [tab, setTab] = React.useState<TemplateType>("homepage");
  const [pending, startTransition] = React.useTransition();

  // Every theme action returns { ok } | { ok: false, error } (see lib/actions/theme.ts) — a
  // thrown error means something unexpected (or RBAC), so it gets a generic toast.
  const run = React.useCallback(
    (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) => {
      if (!canWrite) {
        toast.error("Akses ditolak — peran Anda tidak bisa mengubah tema toko");
        return;
      }
      startTransition(async () => {
        try {
          const res = await fn();
          if (res.ok) {
            toast.success(ok);
            router.refresh();
          } else {
            toast.error(res.error ?? "Gagal menyimpan");
          }
        } catch {
          toast.error("Gagal menyimpan — coba lagi");
        }
      });
    },
    [canWrite, router],
  );

  const active = TABS.find((t) => t.key === tab)!;
  const list = templates.filter((t) => t.type === tab);
  const rows = tab === "category" ? collections : tab === "product" ? products : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tema Toko"
        desc="Susun tampilan storefront dengan drag & drop — beranda, kategori, dan produk."
      >
        <BrandColorDialog initialColor={brandColor} />
        <GalleryLayoutDialog initialLayout={galleryLayout} />
        <Can capability="theme:write">
          <CreateTemplateDialog
            type={tab}
            typeLabel={active.label}
            pending={pending}
            onCreate={(name) =>
              run(async () => {
                const res = await createTemplate(tab, name);
                if (res.ok) router.push(`/tema/${res.id}`);
                return res;
              }, "Template dibuat")
            }
          />
        </Can>
      </PageHeader>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TemplateType)}>
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key} className="gap-1.5">
              {t.label}
              <span className="text-xs text-muted-foreground tabular-nums">
                {templates.filter((x) => x.type === t.key).length}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <p className="text-sm text-muted-foreground">{active.desc}</p>

      {list.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <LayoutTemplate className="size-8 text-muted-foreground" />
            <p className="font-medium">Belum ada template {active.label.toLowerCase()}</p>
            <p className="text-sm text-muted-foreground">Buat template pertama untuk mulai menyusun halaman.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((t) => (
            <TemplateCard
              key={t.id}
              tpl={t}
              pending={pending}
              onRename={(name) => run(() => renameTemplate(t.id, name), "Nama template diperbarui")}
              onDelete={() => run(() => deleteTemplate(t.id), "Template dihapus")}
              onSetDefault={() => run(() => setDefaultTemplate(t.id), "Template default diperbarui")}
            />
          ))}
        </div>
      )}

      {tab !== "homepage" && (
        <AssignmentTable
          kind={tab === "category" ? "collection" : "product"}
          label={tab === "category" ? "Kategori" : "Produk"}
          rows={rows}
          templates={list}
          pending={pending}
          onAssign={(id, templateId) =>
            run(
              () =>
                tab === "category" ? assignCollectionTemplate(id, templateId) : assignProductTemplate(id, templateId),
              "Template diterapkan",
            )
          }
          onBulk={(ids, templateId) =>
            run(
              () => assignTemplateBulk(tab === "category" ? "collection" : "product", ids, templateId),
              `Template diterapkan ke ${ids.length} item`,
            )
          }
        />
      )}
    </div>
  );
}

function TemplateCard({
  tpl,
  pending,
  onRename,
  onDelete,
  onSetDefault,
}: {
  tpl: TemplateSummary;
  pending: boolean;
  onRename: (name: string) => void;
  onDelete: () => void;
  onSetDefault: () => void;
}) {
  const [renameOpen, setRenameOpen] = React.useState(false);
  const [name, setName] = React.useState(tpl.name);

  return (
    <Card className="overflow-hidden">
      <CardContent className="space-y-3 py-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="line-clamp-2 min-w-0 flex-1 break-words font-medium" title={tpl.name}>{tpl.name}</p>
              {tpl.isDefault && (
                <Badge variant="secondary" className="gap-1">
                  <Star className="size-3" /> Default
                </Badge>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground tabular-nums">
              {tpl.sectionCount} seksi · diperbarui {dateFmt.format(new Date(tpl.updatedAt))}
              {tpl.type !== "homepage" ? ` · dipakai ${tpl.assignedCount} halaman` : ""}
            </p>
            {tpl.type === "category" && tpl.sectionCount > 0 && !tpl.hasProductGrid && (
              <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-500">
                Template ini belum punya seksi <strong>Daftar Produk</strong> — kategori yang
                memakainya hanya menampilkan judul dan sampulnya, tanpa satu pun produk.
              </p>
            )}
          </div>
          <Can capability="theme:write">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="ghost" size="icon" aria-label="Aksi template" disabled={pending}>
                    <MoreHorizontal />
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setRenameOpen(true)}>
                  <Pencil data-icon="inline-start" /> Ganti nama
                </DropdownMenuItem>
                {!tpl.isDefault && (
                  <DropdownMenuItem onClick={onSetDefault}>
                    <Check data-icon="inline-start" /> Jadikan default
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={onDelete}>
                  <Trash2 data-icon="inline-start" /> Hapus
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </Can>
        </div>

        <Button
          nativeButton={false}
          variant="outline"
          size="sm"
          className="w-full"
          render={<Link href={`/tema/${tpl.id}`} />}
        >
          <Pencil data-icon="inline-start" />
          Buka Builder
        </Button>
      </CardContent>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ganti Nama Template</DialogTitle>
            <DialogDescription>Nama ini hanya tampil di Dashboard Seller, bukan di storefront.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={`rename-${tpl.id}`}>Nama Template</Label>
            <Input id={`rename-${tpl.id}`} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline">Batal</Button>} />
            <Button
              disabled={pending || !name.trim()}
              onClick={() => {
                onRename(name);
                setRenameOpen(false);
              }}
            >
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function CreateTemplateDialog({
  type,
  typeLabel,
  pending,
  onCreate,
}: {
  type: TemplateType;
  typeLabel: string;
  pending: boolean;
  onCreate: (name: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button disabled={pending}>
            <Plus data-icon="inline-start" />
            Template {typeLabel}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Template {typeLabel} Baru</DialogTitle>
          <DialogDescription>
            Beri nama, lalu susun seksinya di builder. Template pertama dari tiap jenis otomatis menjadi default.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="new-template-name">Nama Template</Label>
          <Input
            id="new-template-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={type === "homepage" ? "Beranda Lebaran" : `Tata Letak ${typeLabel} Minimal`}
          />
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline">Batal</Button>} />
          <Button
            disabled={pending || !name.trim()}
            onClick={() => {
              onCreate(name);
              setOpen(false);
              setName("");
            }}
          >
            Buat & Buka Builder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssignmentTable({
  kind,
  label,
  rows,
  templates,
  pending,
  onAssign,
  onBulk,
}: {
  kind: "collection" | "product";
  label: string;
  rows: TemplateAssignment[];
  templates: TemplateSummary[];
  pending: boolean;
  onAssign: (id: string, templateId: string | null) => void;
  onBulk: (ids: string[], templateId: string | null) => void;
}) {
  const canWrite = useCan("theme:write");
  const [selected, setSelected] = React.useState<string[]>([]);
  const fallback = templates.find((t) => t.isDefault);

  const toggle = (id: string, on: boolean) =>
    setSelected((s) => (on ? Array.from(new Set([...s, id])) : s.filter((x) => x !== id)));

  const nameOf = (id: string | null) => templates.find((t) => t.id === id)?.name;
  const labelFor = (id: string | null) => nameOf(id) ?? (fallback ? `Default (${fallback.name})` : "Default");

  return (
    <Card>
      <CardContent className="space-y-4 py-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-medium">Penetapan Template — {label}</h2>
            <p className="text-sm text-muted-foreground">
              {fallback
                ? `Tanpa penetapan, halaman memakai template default "${fallback.name}".`
                : "Belum ada template default — buat satu dulu agar halaman punya cadangan."}
            </p>
          </div>
          {canWrite && selected.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground tabular-nums">{selected.length} dipilih</span>
              <TemplatePicker
                templates={templates}
                value={null}
                pending={pending}
                triggerLabel="Terapkan ke terpilih"
                onSelect={(templateId) => {
                  onBulk(selected, templateId);
                  setSelected([]);
                }}
              />
            </div>
          )}
        </div>

        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Belum ada {label.toLowerCase()}.</p>
        ) : (
          <div className="max-h-[28rem] overflow-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  {canWrite && <TableHead className="w-10" />}
                  <TableHead>{label}</TableHead>
                  <TableHead className="w-72">Template</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    {canWrite && (
                      <TableCell>
                        <Checkbox
                          checked={selected.includes(r.id)}
                          onCheckedChange={(on) => toggle(r.id, Boolean(on))}
                          aria-label={`Pilih ${r.name}`}
                        />
                      </TableCell>
                    )}
                    <TableCell className="max-w-sm">
                      <Link
                        href={kind === "collection" ? `/produk/kategori/${r.id}` : `/produk/${r.id}`}
                        className="line-clamp-2 whitespace-normal break-words font-medium hover:underline"
                        title={r.name}
                      >
                        {r.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {canWrite ? (
                        <TemplatePicker
                          templates={templates}
                          value={r.templateId}
                          pending={pending}
                          triggerLabel={labelFor(r.templateId)}
                          muted={!r.templateId}
                          onSelect={(templateId) => onAssign(r.id, templateId)}
                        />
                      ) : (
                        <span className="text-sm text-muted-foreground">{labelFor(r.templateId)}</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          {kind === "collection"
            ? "Penetapan disimpan di collections.template_id — storefront membacanya saat merender halaman kategori."
            : "Penetapan disimpan di products.template_id — storefront membacanya saat merender halaman produk."}
        </p>
      </CardContent>
    </Card>
  );
}

// Base UI's `Select` is off-limits in this codebase (CLAUDE.md) — the picker is a DropdownMenu.
function TemplatePicker({
  templates,
  value,
  pending,
  triggerLabel,
  muted,
  onSelect,
}: {
  templates: TemplateSummary[];
  value: string | null;
  pending: boolean;
  triggerLabel: string;
  muted?: boolean;
  onSelect: (templateId: string | null) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            disabled={pending || templates.length === 0}
            className={muted ? "text-muted-foreground" : undefined}
          >
            <span className="max-w-48 truncate">{triggerLabel}</span>
            <ChevronDown data-icon="inline-end" />
          </Button>
        }
      />
      <DropdownMenuContent align="start">
        <DropdownMenuItem onClick={() => onSelect(null)}>
          {value === null && <Check data-icon="inline-start" />}
          Pakai template default
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {templates.map((t) => (
          <DropdownMenuItem key={t.id} onClick={() => onSelect(t.id)}>
            {value === t.id && <Check data-icon="inline-start" />}
            {t.name}
            {t.isDefault ? <span className="ml-1 text-xs text-muted-foreground">(default)</span> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
