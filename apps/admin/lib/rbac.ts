import "server-only";
import { getSession, type Session } from "@/lib/auth";

// Role-based access control. Roles come from `store_users.role` (in the session JWT).
// The capability matrix is the single source of truth — server actions gate on a
// capability, UI can read `can()` to hide/disable controls. Keep in sync with the
// `store_user_role` enum in packages/db (owner | admin | staff | gudang).

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

const ALL: Capability[] = [
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
  owner: ALL,
  admin: ALL.filter((c) => c !== "settings:write"),
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

export class ForbiddenError extends Error {
  readonly capability: Capability;
  constructor(cap: Capability) {
    super(`Akses ditolak — peran Anda tidak punya izin “${cap}”.`);
    this.name = "ForbiddenError";
    this.capability = cap;
  }
}

// Gate a server action. Returns the session (so callers get storeId/role/userId)
// or throws ForbiddenError when the current role lacks the capability.
export async function requireCapability(cap: Capability): Promise<Session> {
  const session = await getSession();
  if (!session) throw new ForbiddenError(cap);
  if (!can(session.role, cap)) throw new ForbiddenError(cap);
  return session;
}
