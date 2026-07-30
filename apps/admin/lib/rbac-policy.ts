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
  | "settings:write"
  | "support:write" // Bantuan — open/reply/close platform support tickets
  // Obrolan — shopper ⇄ merchant chat (specs/docs/CHAT_SPEC.md §6). `chat:read` is the FIRST read
  // capability in this matrix: the /obrolan route guards on it too, not just the sidebar, because
  // hiding a nav item is not access control.
  | "chat:read"
  | "chat:write"
  | "theme:write" // Store Builder (ADR 0009) — homepage/category/product section templates
  | "integrations:write" // marketing pixels / CAPI / Meta connection (ADR 0012) — owner-only, like settings
  // Landing HTML — pasting RAW MARKUP that the storefront renders with `set:html`, i.e. it is emitted
  // into the SSR response body and PARSED by the browser: a `<script>` tag in it RUNS, on the shop's
  // own origin, on a page that carries the COD order form (name, WhatsApp, full address). There is no
  // sanitizer and no CSP. It used to need only `content:write`, which `staff` holds in EVERY tenant.
  // Owner-only (2026-07-30 decision) — the narrowest fix that does not pretend a regex sanitizer is
  // one. Editing the REST of a landing (title, slug, product, funnel config) still needs only
  // `content:write`: the escalation is on the executable markup, not on the feature.
  | "landing:html";

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
  "support:write",
  "chat:read",
  "chat:write",
  "theme:write",
  "integrations:write",
  "landing:html",
];

// Who can do what.
// - owner  : full control (incl. store settings).
// - admin  : full operational control, minus store-level settings.
// - staff  : run the shop (produk/pesanan/pelanggan/konten/diskon/crm) — no destructive
//            product delete, no warehouse (inventori/pembelian), no settings.
// - gudang : warehouse only — stok + purchase orders.
// `support:write` (Bantuan) is granted to EVERY role — anyone working in the store must be
// able to ask the platform for help; the tenant boundary is RLS, not the role.
export const ROLE_CAPS: Record<Role, readonly Capability[]> = {
  owner: ALL_CAPABILITIES,
  // A tracking/Meta connection stores tenant secrets + is a store-level setting → owner-only, like settings.
  admin: ALL_CAPABILITIES.filter(
    (c) => c !== "settings:write" && c !== "integrations:write" && c !== "landing:html",
  ),
  staff: [
    "products:write",
    "discounts:write",
    "content:write",
    "orders:write",
    "customers:write",
    "crm:write",
    "media:write",
    "support:write",
    // Staff answer shoppers — that IS the job. Gudang does not (spec §6): a warehouse role has no
    // business reading customer conversations.
    "chat:read",
    "chat:write",
  ],
  gudang: ["inventory:write", "purchases:write", "support:write"],
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
