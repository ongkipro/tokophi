"use client";

import * as React from "react";
import {
  Plus,
  Pencil,
  Trash2,
  GripVertical,
  ChevronRight,
  Menu as MenuIcon,
} from "lucide-react";

import { PageHeader } from "@/components/admin/page-header";
import { MENUS, type NavMenu, type NavItem } from "@/lib/mock/store";
import { TYPE_META } from "@/components/admin/navigasi/nav-meta";
import {
  ItemFormDialog,
  type ItemDraft,
} from "@/components/admin/navigasi/item-form-dialog";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
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

// ---- local state helpers ----
function cloneItems(items: NavItem[]): NavItem[] {
  return items.map((it) => ({
    ...it,
    children: it.children ? cloneItems(it.children) : undefined,
  }));
}
function seedMenus(): NavMenu[] {
  return MENUS.map((m) => ({ ...m, items: cloneItems(m.items) }));
}

function countItems(items: NavItem[]): number {
  return items.reduce(
    (n, it) => n + 1 + (it.children ? countItems(it.children) : 0),
    0,
  );
}

// slugify a menu title into a handle (mirrors Shopify auto-handle behaviour).
function toHandle(title: string): string {
  return (
    title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "menu"
  );
}

function makeId(): string {
  return `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// Immutable remove-by-id across the (one-level) tree.
function removeItem(items: NavItem[], id: string): NavItem[] {
  return items
    .filter((it) => it.id !== id)
    .map((it) =>
      it.children ? { ...it, children: removeItem(it.children, id) } : it,
    );
}

// Immutable update-by-id across the tree.
function updateItem(items: NavItem[], id: string, draft: ItemDraft): NavItem[] {
  return items.map((it) => {
    if (it.id === id) return { ...it, ...draft };
    if (it.children)
      return { ...it, children: updateItem(it.children, id, draft) };
    return it;
  });
}

function findItem(items: NavItem[], id: string): NavItem | null {
  for (const it of items) {
    if (it.id === id) return it;
    if (it.children) {
      const found = findItem(it.children, id);
      if (found) return found;
    }
  }
  return null;
}

// ---- row ----
function ItemRow({
  item,
  depth,
  onEdit,
  onDelete,
}: {
  item: NavItem;
  depth: number;
  onEdit: (item: NavItem) => void;
  onDelete: (id: string) => void;
}) {
  const meta = TYPE_META[item.type];
  const Icon = meta.icon;
  return (
    <div>
      <div className="group flex items-center gap-3 rounded-lg border bg-card px-2.5 py-2 ring-foreground/5 transition-colors hover:bg-muted/40">
        <GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground/50" />
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-tight">{item.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {meta.label}
            {item.target && (
              <>
                {" · "}
                <span className="font-mono">{item.target}</span>
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5 opacity-70 transition-opacity group-hover:opacity-100">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Edit ${item.title}`}
            onClick={() => onEdit(item)}
          >
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Hapus ${item.title}`}
            className="text-muted-foreground hover:text-destructive"
            onClick={() => onDelete(item.id)}
          >
            <Trash2 />
          </Button>
        </div>
      </div>

      {item.children && item.children.length > 0 && (
        <div className="ml-6 mt-2 flex flex-col gap-2 border-l pl-6">
          {item.children.map((child) => (
            <ItemRow
              key={child.id}
              item={child}
              depth={depth + 1}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---- create-menu dialog ----
function CreateMenuDialog({ onCreate }: { onCreate: (title: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const handle = title.trim() ? toHandle(title) : "";

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setTitle("");
      }}
    >
      <DialogTrigger
        render={
          <Button>
            <Plus />
            Buat menu
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Buat menu baru</DialogTitle>
          <DialogDescription>
            Menu baru mulai kosong. Anda bisa menambah item setelahnya.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 py-1">
          <Label htmlFor="menu-title">Judul menu</Label>
          <Input
            id="menu-title"
            placeholder="mis. Menu Promo"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
          {handle && (
            <p className="text-xs text-muted-foreground">
              Handle: <span className="font-mono">{handle}</span>
            </p>
          )}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline">Batal</Button>} />
          <Button
            disabled={!title.trim()}
            onClick={() => {
              onCreate(title.trim());
              setOpen(false);
            }}
          >
            Buat menu
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- page ----
export default function Page() {
  const [menus, setMenus] = React.useState<NavMenu[]>(seedMenus);
  const [activeHandle, setActiveHandle] = React.useState(
    () => menus[0]?.handle ?? "",
  );

  // Item add/edit dialog state.
  const [itemDialogOpen, setItemDialogOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);

  const activeMenu =
    menus.find((m) => m.handle === activeHandle) ?? menus[0] ?? null;

  const editingItem =
    editingId && activeMenu ? findItem(activeMenu.items, editingId) : null;

  function patchActive(updater: (m: NavMenu) => NavMenu) {
    setMenus((prev) =>
      prev.map((m) => (m.handle === activeMenu?.handle ? updater(m) : m)),
    );
  }

  function handleRename(title: string) {
    patchActive((m) => ({ ...m, title }));
  }

  function handleDelete(id: string) {
    patchActive((m) => ({ ...m, items: removeItem(m.items, id) }));
  }

  function openAdd() {
    setEditingId(null);
    setItemDialogOpen(true);
  }
  function openEdit(item: NavItem) {
    setEditingId(item.id);
    setItemDialogOpen(true);
  }

  function handleItemSubmit(draft: ItemDraft) {
    if (editingId) {
      patchActive((m) => ({ ...m, items: updateItem(m.items, editingId, draft) }));
    } else {
      const newItem: NavItem = { id: makeId(), ...draft };
      patchActive((m) => ({ ...m, items: [...m.items, newItem] }));
    }
  }

  function handleCreateMenu(title: string) {
    const base = toHandle(title);
    let handle = base;
    let i = 2;
    while (menus.some((m) => m.handle === handle)) handle = `${base}-${i++}`;
    setMenus((prev) => [...prev, { handle, title, isDefault: false, items: [] }]);
    setActiveHandle(handle);
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Navigasi"
        desc="Atur menu yang tampil di header dan footer toko Anda."
      >
        <CreateMenuDialog onCreate={handleCreateMenu} />
      </PageHeader>

      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        {/* LEFT: menu list */}
        <div className="flex flex-col gap-3">
          <Card className="py-0">
            <CardContent className="flex flex-col gap-1 p-2">
              {menus.map((m) => {
                const active = m.handle === activeMenu?.handle;
                return (
                  <button
                    key={m.handle}
                    type="button"
                    onClick={() => setActiveHandle(m.handle)}
                    className={[
                      "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors",
                      active
                        ? "bg-muted ring-1 ring-foreground/10"
                        : "hover:bg-muted/50",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "flex size-8 shrink-0 items-center justify-center rounded-md",
                        active
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground",
                      ].join(" ")}
                    >
                      <MenuIcon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium">
                          {m.title}
                        </span>
                        {m.isDefault && (
                          <Badge variant="outline" className="h-4 px-1 text-[10px]">
                            Utama
                          </Badge>
                        )}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        <span className="font-mono">{m.handle}</span> ·{" "}
                        {countItems(m.items)} item
                      </p>
                    </div>
                    <ChevronRight
                      className={[
                        "size-4 shrink-0",
                        active ? "text-foreground" : "text-muted-foreground/50",
                      ].join(" ")}
                    />
                  </button>
                );
              })}
            </CardContent>
          </Card>
          <p className="px-1 text-xs text-muted-foreground">
            {menus.length} menu tersimpan. Menu bertanda “Utama” tampil di header
            toko.
          </p>
        </div>

        {/* RIGHT: editor */}
        {activeMenu ? (
          <Card>
            <CardHeader className="gap-4">
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="menu-judul">Judul menu</Label>
                  {activeMenu.isDefault && (
                    <Badge variant="outline" className="h-4 px-1 text-[10px]">
                      Utama
                    </Badge>
                  )}
                </div>
                <Input
                  id="menu-judul"
                  value={activeMenu.title}
                  onChange={(e) => handleRename(e.target.value)}
                  className="max-w-sm text-base font-medium"
                />
                <p className="text-xs text-muted-foreground">
                  Handle: <span className="font-mono">{activeMenu.handle}</span>
                </p>
              </div>
            </CardHeader>

            <Separator />

            <CardContent className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Item menu</h3>
                <span className="text-xs text-muted-foreground">
                  {countItems(activeMenu.items)} item
                </span>
              </div>

              {activeMenu.items.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {activeMenu.items.map((item) => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      depth={0}
                      onEdit={openEdit}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed py-10 text-center">
                  <p className="text-sm font-medium">Belum ada item</p>
                  <p className="text-xs text-muted-foreground">
                    Tambahkan tautan pertama untuk menu ini.
                  </p>
                </div>
              )}

              <button
                type="button"
                onClick={openAdd}
                className="flex items-center justify-center gap-2 rounded-lg border border-dashed py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-muted/40 hover:text-foreground"
              >
                <Plus className="size-4" />
                Tambah item menu
              </button>
            </CardContent>

            <Separator />

            <CardContent className="flex items-center justify-end gap-2">
              <Button variant="outline" onClick={() => setMenus(seedMenus())}>
                Batal
              </Button>
              <Button>Simpan menu</Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="py-16 text-center text-sm text-muted-foreground">
              Pilih menu di sebelah kiri untuk mulai menyunting.
            </CardContent>
          </Card>
        )}
      </div>

      <ItemFormDialog
        open={itemDialogOpen}
        onOpenChange={setItemDialogOpen}
        initial={editingItem}
        onSubmit={handleItemSubmit}
      />
    </div>
  );
}
