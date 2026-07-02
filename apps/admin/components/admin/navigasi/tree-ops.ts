import type { NavItem } from "@/lib/mock/store";

// Pure, immutable transforms for the 2-level navigation tree
// (top-level items + one level of children). Every function returns a NEW
// array and never mutates its input — safe to feed straight into setState.

export type DropPos = "before" | "after";

// Returns the parent id of `id`:
//   - `null`      → item is top-level
//   - <string>    → item is a child, value is its parent's id
//   - `undefined` → id not found in the tree
export function parentIdOf(
  items: NavItem[],
  id: string,
): string | null | undefined {
  for (const it of items) {
    if (it.id === id) return null;
    if (it.children) {
      for (const c of it.children) if (c.id === id) return it.id;
    }
  }
  return undefined;
}

// Reorder a flat list: move `dragId` to sit before/after `overId`.
function reorderList(
  list: NavItem[],
  dragId: string,
  overId: string,
  pos: DropPos,
): NavItem[] {
  const moved = list.find((i) => i.id === dragId);
  if (!moved) return list;
  const without = list.filter((i) => i.id !== dragId);
  let idx = without.findIndex((i) => i.id === overId);
  if (idx === -1) return list;
  if (pos === "after") idx += 1;
  without.splice(idx, 0, moved);
  return without;
}

// Reorder WITHIN the same level only. Drops across different parents are
// ignored (returns the input unchanged).
export function moveWithinLevel(
  items: NavItem[],
  dragId: string,
  overId: string,
  pos: DropPos,
): NavItem[] {
  if (dragId === overId) return items;
  const dragParent = parentIdOf(items, dragId);
  const overParent = parentIdOf(items, overId);
  if (dragParent === undefined || overParent === undefined) return items;
  if (dragParent !== overParent) return items;

  // Top-level reorder.
  if (dragParent === null) return reorderList(items, dragId, overId, pos);

  // Child reorder inside the shared parent.
  return items.map((it) =>
    it.id === dragParent && it.children
      ? { ...it, children: reorderList(it.children, dragId, overId, pos) }
      : it,
  );
}

// Can this top-level item become a child of the sibling directly above it?
// (Only top-level, non-first items with no children of their own — keeping the
// tree at 2 levels max.)
export function canIndent(items: NavItem[], id: string): boolean {
  const idx = items.findIndex((i) => i.id === id);
  if (idx <= 0) return false;
  const item = items[idx];
  return !(item.children && item.children.length > 0);
}

// Nest a top-level item under the sibling immediately above it.
export function indentItem(items: NavItem[], id: string): NavItem[] {
  const idx = items.findIndex((i) => i.id === id);
  if (idx <= 0) return items;
  const item = items[idx];
  if (item.children && item.children.length > 0) return items;
  const prev = items[idx - 1];
  const next = [...items];
  next[idx - 1] = { ...prev, children: [...(prev.children ?? []), { ...item }] };
  next.splice(idx, 1);
  return next;
}

// Is this item a child (i.e. can it be promoted back to top-level)?
export function canOutdent(items: NavItem[], id: string): boolean {
  return typeof parentIdOf(items, id) === "string";
}

// Promote a child back to top-level, inserted right after its former parent.
export function outdentItem(items: NavItem[], id: string): NavItem[] {
  for (let pi = 0; pi < items.length; pi++) {
    const parent = items[pi];
    if (!parent.children) continue;
    const ci = parent.children.findIndex((c) => c.id === id);
    if (ci === -1) continue;
    const child = parent.children[ci];
    const rest = parent.children.filter((c) => c.id !== id);
    const next = [...items];
    next[pi] = { ...parent, children: rest.length ? rest : undefined };
    next.splice(pi + 1, 0, { ...child, children: undefined });
    return next;
  }
  return items;
}
