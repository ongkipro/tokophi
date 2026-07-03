// Client-safe RBAC policy: the role→capability matrix + can(). No server-only
// imports, so both the server guard (lib/rbac.ts) and client UI (usePermissions)
// share ONE source of truth. Keep the roles in sync with the `store_user_role`
// enum in packages/db (owner | admin | staff | gudang).

export type Role = "owner" | "admin" | "staff" | "gudang";

export type Capability =
  | "products:write"
  | "products:delete"
  | "discounts:write"
  | "content:write" // pages, blog/articles, collections, menus
  | "orders:write"
  | "inventory:write"
  | "purchases:write"
  | "customers:write"
  | "crm:write" // follow-ups, segments
  | "media:write"
  | "settings:write";

export const ALL_CAPABILITIES: Capability[] = [
  "products:write",
  "products:delete",
  "discounts:write",
  "content:write",
  "orders:write",
  "inventory:write",
  "purchases:write",
  "customers:write",
  "crm:write",
  "media:write",
  "settings:write",
];

// Who can do what.
// - owner  : full control (incl. store settings).
// - admin  : full operational control, minus store-level settings.
// - staff  : run the shop (produk/pesanan/pelanggan/konten/diskon/crm) — no destructive
//            product delete, no warehouse (inventori/pembelian), no settings.
// - gudang : warehouse only — stok + purchase orders.
export const ROLE_CAPS: Record<Role, readonly Capability[]> = {
  owner: ALL_CAPABILITIES,
  admin: ALL_CAPABILITIES.filter((c) => c !== "settings:write"),
  staff: [
    "products:write",
    "discounts:write",
    "content:write",
    "orders:write",
    "customers:write",
    "crm:write",
    "media:write",
  ],
  gudang: ["inventory:write", "purchases:write"],
};

export function can(role: Role | string | undefined, cap: Capability): boolean {
  const caps = ROLE_CAPS[role as Role];
  return !!caps && caps.includes(cap);
}

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Pemilik",
  admin: "Admin",
  staff: "Staf",
  gudang: "Gudang",
};
