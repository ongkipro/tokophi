"use client";

import * as React from "react";
import {
  Plus,
  Pencil,
  Trash2,
  GripVertical,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Menu as MenuIcon,
  MoreHorizontal,
  IndentIncrease,
  IndentDecrease,
  CornerDownRight,
  ListPlus,
} from "lucide-react";

import { PageHeader } from "@/components/admin/page-header";
import { type NavMenu, type NavItem } from "@/lib/mock/store";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  createMenu,
  saveMenu,
  type CreateMenuResult,
} from "@/lib/actions/menus";
import { useCan } from "@/components/admin/permissions";
import { TYPE_META } from "@/components/admin/navigasi/nav-meta";
import {
  ItemFormDialog,
  type ItemDraft,
} from "@/components/admin/navigasi/item-form-dialog";
import {
  moveWithinLevel,
  indentItem,
  outdentItem,
  canIndent,
  canOutdent,
  parentIdOf,
  moveItem,
  canMoveItem,
  addChild,
  canHaveChildren,
  type DropPos,
} from "@/components/admin/navigasi/tree-ops";

import { Card, CardContent, CardHeader } from "@tokophi/ui/card";
import { Badge } from "@tokophi/ui/badge";
import { Button } from "@tokophi/ui/button";
import { Input } from "@tokophi/ui/input";
import { Label } from "@tokophi/ui/label";
import { Separator } from "@tokophi/ui/separator";
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

// ---- local state helpers ----
function cloneItems(items: NavItem[]): NavItem[] {
  return items.map((it) => ({
    ...it,
    children: it.children ? cloneItems(it.children) : undefined,
  }));
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

// ---- drag-and-drop context passed down to every row ----
type Dnd = {
  dragId: string | null;
  overId: string | null;
  overPos: DropPos | null;
  onDragStart: (id: string) => void;
  onDragOverItem: (id: string, pos: DropPos) => void;
  onDrop: () => void;
  onDragEnd: () => void;
};

// ---- row ----
function ItemRow({
  item,
  depth,
  canIndentItem,
  canOutdentItem,
  canMoveUpItem,
  canMoveDownItem,
  canAddChildItem,
  onEdit,
  onDelete,
  onIndent,
  onOutdent,
  onMove,
  onAddChild,
  dnd,
}: {
  item: NavItem;
  depth: number;
  canIndentItem: (id: string) => boolean;
  canOutdentItem: (id: string) => boolean;
  canMoveUpItem: (id: string) => boolean;
  canMoveDownItem: (id: string) => boolean;
  canAddChildItem: (id: string) => boolean;
  onEdit: (item: NavItem) => void;
  onDelete: (id: string) => void;
  onIndent: (id: string) => void;
  onOutdent: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onAddChild: (id: string) => void;
  dnd: Dnd;
}) {
  const meta = TYPE_META[item.type];
  const Icon = meta.icon;
  const hasChildren = !!item.children && item.children.length > 0;

  const isDragging = dnd.dragId === item.id;
  const showBefore = dnd.overId === item.id && dnd.overPos === "before";
  const showAfter = dnd.overId === item.id && dnd.overPos === "after";

  const indentable = canIndentItem(item.id);
  const outdentable = canOutdentItem(item.id);
  const movableUp = canMoveUpItem(item.id);
  const movableDown = canMoveDownItem(item.id);
  const addChildable = canAddChildItem(item.id);

  return (
    <div>
      <div
        className="relative"
        draggable
        onDragStart={(e) => {
          e.stopPropagation();
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", item.id);
          dnd.onDragStart(item.id);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move";
          const rect = e.currentTarget.getBoundingClientRect();
          const pos: DropPos =
            e.clientY - rect.top < rect.height / 2 ? "before" : "after";
          dnd.onDragOverItem(item.id, pos);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          dnd.onDrop();
        }}
        onDragEnd={(e) => {
          e.stopPropagation();
          dnd.onDragEnd();
        }}
      >
        {/* drop indicators */}
        {showBefore && (
          <div className="pointer-events-none absolute inset-x-0 -top-1 z-10 h-0.5 rounded-full bg-primary" />
        )}
        {showAfter && (
          <div className="pointer-events-none absolute inset-x-0 -bottom-1 z-10 h-0.5 rounded-full bg-primary" />
        )}

        <div
          className={[
            "group flex items-center gap-3 rounded-lg border bg-card px-2.5 py-2 ring-foreground/5 transition-colors hover:bg-muted/40",
            isDragging ? "opacity-40" : "",
          ].join(" ")}
        >
          <GripVertical
            className="size-4 shrink-0 cursor-grab text-muted-foreground/50 active:cursor-grabbing"
            aria-hidden
          />
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Icon className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <p className="line-clamp-2 min-w-0 flex-1 break-words text-sm font-semibold leading-tight" title={item.title}>
                {item.title}
              </p>
              {hasChildren && (
                <Badge variant="outline" className="h-4 shrink-0 px-1 text-[10px]">
                  Sub-menu
                </Badge>
              )}
            </div>
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
              aria-label={`Naikkan ${item.title}`}
              disabled={!movableUp}
              onClick={() => onMove(item.id, -1)}
            >
              <ChevronUp />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Turunkan ${item.title}`}
              disabled={!movableDown}
              onClick={() => onMove(item.id, 1)}
            >
              <ChevronDown />
            </Button>
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
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Aksi lain untuk ${item.title}`}
                  >
                    <MoreHorizontal />
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="w-56">
                {addChildable && (
                  <>
                    <DropdownMenuItem onClick={() => onAddChild(item.id)}>
                      <ListPlus />
                      Tambah sub-menu
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem
                  disabled={!indentable}
                  onClick={() => onIndent(item.id)}
                >
                  <IndentIncrease />
                  Jadikan sub-menu
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!outdentable}
                  onClick={() => onOutdent(item.id)}
                >
                  <IndentDecrease />
                  Naikkan jadi menu induk
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onEdit(item)}>
                  <Pencil />
                  Sunting
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={() => onDelete(item.id)}
                >
                  <Trash2 />
                  Hapus
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {hasChildren && (
        <div className="ml-6 mt-2 flex flex-col gap-2 border-l pl-6">
          {item.children!.map((child) => (
            <div key={child.id} className="relative">
              <CornerDownRight
                className="pointer-events-none absolute -left-[1.35rem] top-3.5 size-3.5 text-muted-foreground/40"
                aria-hidden
              />
              <ItemRow
                item={child}
                depth={depth + 1}
                canIndentItem={canIndentItem}
                canOutdentItem={canOutdentItem}
                canMoveUpItem={canMoveUpItem}
                canMoveDownItem={canMoveDownItem}
                canAddChildItem={canAddChildItem}
                onEdit={onEdit}
                onDelete={onDelete}
                onIndent={onIndent}
                onOutdent={onOutdent}
                onMove={onMove}
                onAddChild={onAddChild}
                dnd={dnd}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- create-menu dialog ----
function CreateMenuDialog({
  onCreate,
  disabled,
}: {
  onCreate: (title: string) => Promise<CreateMenuResult>;
  disabled: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startCreating] = React.useTransition();
  const handle = title.trim() ? toHandle(title) : "";

  function submit() {
    startCreating(async () => {
      setError(null);
      try {
        const result = await onCreate(title.trim());
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setOpen(false);
      } catch {
        setError("Gagal membuat menu. Coba lagi.");
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (pending) return;
        setOpen(nextOpen);
        if (nextOpen) {
          setTitle("");
          setError(null);
        }
      }}
    >
      <DialogTrigger
        render={
          <Button disabled={disabled}>
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
            onChange={(event) => setTitle(event.target.value)}
            disabled={pending}
            autoFocus
          />
          {handle && (
            <p className="text-xs text-muted-foreground">
              Handle: <span className="font-mono">{handle}</span>
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <DialogClose
            render={
              <Button variant="outline" disabled={pending}>
                Batal
              </Button>
            }
          />
          <Button disabled={!title.trim() || pending} onClick={submit}>
            {pending ? "Membuat…" : "Buat menu"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- page ----
export function NavigasiClient({ menus: initialMenus }: { menus: NavMenu[] }) {
  const [menus, setMenus] = React.useState<NavMenu[]>(() =>
    initialMenus.map((m) => ({ ...m, items: cloneItems(m.items) })),
  );
  const [activeHandle, setActiveHandle] = React.useState(
    () => menus[0]?.handle ?? "",
  );

  // Item add/edit dialog state.
  const [itemDialogOpen, setItemDialogOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  // When adding a sub-menu, the parent it will be nested under.
  const [addParentId, setAddParentId] = React.useState<string | null>(null);

  // Drag-and-drop state (native HTML5 DnD).
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [over, setOver] = React.useState<{ id: string; pos: DropPos } | null>(
    null,
  );

  const activeMenu =
    menus.find((m) => m.handle === activeHandle) ?? menus[0] ?? null;

  const router = useRouter();
  const canWrite = useCan("content:write");
  const [saving, startSaving] = React.useTransition();
  const handleSaveMenu = () => {
    if (!activeMenu) return;
    if (!canWrite) {
      toast.error("Akses ditolak — peran Anda tidak bisa mengubah menu");
      return;
    }
    startSaving(async () => {
      try {
        const result = await saveMenu({
          handle: activeMenu.handle,
          title: activeMenu.title,
          items: activeMenu.items,
        });
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        toast.success("Menu disimpan");
        router.refresh();
      } catch {
        toast.error("Gagal menyimpan menu");
      }
    });
  };

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
    setAddParentId(null);
    setItemDialogOpen(true);
  }
  function openEdit(item: NavItem) {
    setEditingId(item.id);
    setAddParentId(null);
    setItemDialogOpen(true);
  }
  function openAddChild(parentId: string) {
    setEditingId(null);
    setAddParentId(parentId);
    setItemDialogOpen(true);
  }

  function handleItemSubmit(draft: ItemDraft) {
    if (editingId) {
      patchActive((m) => ({ ...m, items: updateItem(m.items, editingId, draft) }));
    } else if (addParentId) {
      const child: NavItem = { id: makeId(), ...draft };
      patchActive((m) => ({ ...m, items: addChild(m.items, addParentId, child) }));
    } else {
      const newItem: NavItem = { id: makeId(), ...draft };
      patchActive((m) => ({ ...m, items: [...m.items, newItem] }));
    }
    setAddParentId(null);
  }

  function handleIndent(id: string) {
    patchActive((m) => ({ ...m, items: indentItem(m.items, id) }));
  }
  function handleOutdent(id: string) {
    patchActive((m) => ({ ...m, items: outdentItem(m.items, id) }));
  }
  function handleMove(id: string, dir: -1 | 1) {
    patchActive((m) => ({ ...m, items: moveItem(m.items, id, dir) }));
  }

  // ---- drag-and-drop handlers (reorder within the same level only) ----
  const dnd: Dnd = {
    dragId,
    overId: over?.id ?? null,
    overPos: over?.pos ?? null,
    onDragStart: (id) => setDragId(id),
    onDragOverItem: (id, pos) => {
      const items = activeMenu?.items ?? [];
      if (!dragId || dragId === id) {
        setOver(null);
        return;
      }
      // Only allow (and highlight) a drop when both rows share a level.
      if (parentIdOf(items, dragId) !== parentIdOf(items, id)) {
        setOver(null);
        return;
      }
      setOver((prev) =>
        prev && prev.id === id && prev.pos === pos ? prev : { id, pos },
      );
    },
    onDrop: () => {
      if (dragId && over) {
        patchActive((m) => ({
          ...m,
          items: moveWithinLevel(m.items, dragId, over.id, over.pos),
        }));
      }
      setDragId(null);
      setOver(null);
    },
    onDragEnd: () => {
      setDragId(null);
      setOver(null);
    },
  };

  const itemCanIndent = React.useCallback(
    (id: string) => (activeMenu ? canIndent(activeMenu.items, id) : false),
    [activeMenu],
  );
  const itemCanOutdent = React.useCallback(
    (id: string) => (activeMenu ? canOutdent(activeMenu.items, id) : false),
    [activeMenu],
  );
  const itemCanMoveUp = React.useCallback(
    (id: string) => (activeMenu ? canMoveItem(activeMenu.items, id, -1) : false),
    [activeMenu],
  );
  const itemCanMoveDown = React.useCallback(
    (id: string) => (activeMenu ? canMoveItem(activeMenu.items, id, 1) : false),
    [activeMenu],
  );
  const itemCanAddChild = React.useCallback(
    (id: string) => (activeMenu ? canHaveChildren(activeMenu.items, id) : false),
    [activeMenu],
  );

  async function handleCreateMenu(
    title: string,
  ): Promise<CreateMenuResult> {
    if (!canWrite) {
      return {
        ok: false,
        code: "save_failed",
        error: "Akses ditolak — peran Anda tidak bisa membuat menu",
      };
    }

    const result = await createMenu({ title, items: [] });
    if (!result.ok) {
      toast.error(result.error);
      return result;
    }

    const created = {
      handle: result.handle,
      title,
      isDefault: false,
      items: [],
    };
    setMenus((previous) => [...previous, created]);
    setActiveHandle(result.handle);
    toast.success("Menu dibuat");
    router.refresh();
    return result;
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Navigasi"
        desc="Atur menu yang tampil di header dan footer toko Anda."
      >
        <CreateMenuDialog onCreate={handleCreateMenu} disabled={!canWrite} />
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
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="line-clamp-2 min-w-0 flex-1 break-words text-sm font-medium" title={m.title}>
                          {m.title}
                        </span>
                        {m.isDefault && (
                          <Badge variant="outline" className="h-4 shrink-0 px-1 text-[10px]">
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
                {/* h2, not h3 — this page's only other heading is the page `<h1>`, so an h3 here
                    skipped a level, and a skipped level is what a screen-reader user navigates by
                    (the same rule `Multicolumn.astro` already spells out on the storefront). The
                    class is unchanged: the size is set by `text-sm`, not by the tag. */}
                <h2 className="text-sm font-semibold">Item menu</h2>
                <span className="text-xs text-muted-foreground">
                  {countItems(activeMenu.items)} item
                </span>
              </div>
              <p className="-mt-1 text-xs text-muted-foreground">
                Urutkan dengan tombol ↑ ↓ (atau seret). Pakai “Tambah sub-menu”
                di item induk, atau “Jadikan sub-menu” untuk menyusun bertingkat.
              </p>

              {activeMenu.items.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {activeMenu.items.map((item) => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      depth={0}
                      canIndentItem={itemCanIndent}
                      canOutdentItem={itemCanOutdent}
                      canMoveUpItem={itemCanMoveUp}
                      canMoveDownItem={itemCanMoveDown}
                      canAddChildItem={itemCanAddChild}
                      onEdit={openEdit}
                      onDelete={handleDelete}
                      onIndent={handleIndent}
                      onOutdent={handleOutdent}
                      onMove={handleMove}
                      onAddChild={openAddChild}
                      dnd={dnd}
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
              <Button variant="outline" onClick={() => setMenus(initialMenus.map((m) => ({ ...m, items: cloneItems(m.items) })))}>
                Batal
              </Button>
              {canWrite && <Button onClick={handleSaveMenu} disabled={saving}>{saving ? "Menyimpan…" : "Simpan menu"}</Button>}
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
