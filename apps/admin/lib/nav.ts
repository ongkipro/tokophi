import { LayoutDashboard, ShoppingBag, Wallet, Package, Users, TicketPercent, BarChart3, Megaphone, Settings, FileText, Newspaper, ListTree, MessageSquare, MessagesSquare, LifeBuoy, Palette, FolderOpen, type LucideIcon } from "lucide-react";

export type NavChild = { label: string; href: string };

/** Counts the nav can show. A key, never a literal: `badge: "7"` used to live here — a hardcoded
 *  string that had counted nothing, was wrong for every store, and would have stayed wrong forever.
 *  The value is fetched server-side and passed into <NavLinks counts=… />. */
export type NavBadgeKey = "perluDikirim";
export type NavItem = { label: string; href: string; icon: LucideIcon; badgeKey?: NavBadgeKey; children?: NavChild[] };
export type NavGroup = { label?: string; items: NavItem[] };

// Shopify-core IA minus Themes & Apps/Plugins; Produk & Pelanggan have submenus.
export const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { label: "Dashboard", href: "/", icon: LayoutDashboard },
      // Shopee's Pesanan submenu is four items; ours is three, because two of theirs
      // ("Pengiriman Massal", "Serah Terima Pesanan") are features TokoΦ does not have — a nav row
      // that opens onto nothing is worse than a nav row that isn't there. What is left are the two
      // views a seller actually lives in, as saved links onto the real list: the queue of parcels
      // to pack, and the pile of orders that went wrong.
      {
          // href lands on the tab the BADGE counts, not on the full list: a badge that says "12"
          // and then shows you 685 orders is a broken promise — the seller still has to find the
          // twelve. The whole list is one row below ("Pesanan Saya"), so nothing is lost.
          label: "Pesanan", href: "/pesanan?tab=perlu_dikirim", icon: ShoppingBag, badgeKey: "perluDikirim",
        children: [
          { label: "Pesanan Saya", href: "/pesanan" },
          // "Perlu Dikirim" used to sit here as a saved link to ?tab=perlu_dikirim. It was removed:
          // the LIST already has that tab, and the parent row above now points at it too (it is what
          // the badge counts), so the sub-item was the same view offered three times.
          { label: "Pengiriman Massal", href: "/pesanan/massal" },
          { label: "Pengembalian/Pembatalan", href: "/pesanan?tab=pengembalian" },
        ],
      },
      // Keuangan. This REVERSES the old "Saldo is deliberately not in the sidebar" rule (Shopify's
      // restraint: money is a thing you glance at, not a place you navigate to). That reasoning is
      // sound — for Shopify's market. It is wrong for this one: Shopee, Tokopedia and TikTok Shop
      // Seller all put **Keuangan** in the sidebar, so an Indonesian seller looks for it there and
      // finds nothing. The topbar chip stays — the two do different jobs: the chip is the glance,
      // this is the work (withdraw, check what is still held).
      //
      // Every row points at a view that EXISTS — the nav rule that killed "Pengiriman Massal" and
      // "Serah Terima" until they were built. Each row answers a DIFFERENT question; the first cut
      // pointed four of them at /saldo's own tabs, which is four doors onto one room and exactly what
      // "Perlu Dikirim" was deleted for. A sub-menu is not a tab bar with more clicks.
      //   Keuangan    → is my money healthy?
      //   Penghasilan → what did I earn, and why is it not cash yet?  (Shopee/Tokopedia split this
      //                 from Saldo for a real reason: earnings include money still being held, and
      //                 our `pending` is held against orders that have not reached `selesai` — the
      //                 same order-completion mechanic, not a payment-settlement lag.)
      //   Saldo Saya  → what can I withdraw right now?  (Mutasi/Proses/Penarikan/Rekening are its OWN
      //                 tabs and they STAY there — that genuinely is one room.)
      //
      // ⚠️ **Tagihan & Langganan is deliberately NOT here** (removed 2026-07-17, user's call).
      // Keuangan is money the shop EARNED from shoppers; Langganan is money the merchant PAYS US.
      // Filing our invoice beside their revenue reads as a deduction from earnings — i.e. exactly the
      // take-rate model TokoΦ does not have and is differentiating against (we charge a subscription,
      // never a commission). It also gave /akun/langganan a second nav door next to the avatar menu's.
      // The cross-link survives where it has context: the "Langganan TokoΦ" card on /keuangan.
      {
        label: "Keuangan", href: "/keuangan", icon: Wallet,
        children: [
          { label: "Ringkasan", href: "/keuangan" },
          { label: "Penghasilan", href: "/keuangan/penghasilan" },
          { label: "Saldo Saya", href: "/saldo" },
        ],
      },
      {
        label: "Produk", href: "/produk", icon: Package,
        children: [
          { label: "Kategori", href: "/produk/kategori" },
          { label: "Inventori", href: "/produk/inventori" },
          { label: "Pembelian", href: "/produk/pembelian" },
        ],
      },
      {
        label: "Pelanggan", href: "/pelanggan", icon: Users,
        children: [
          // The carts that never became orders — ~80% of them, in this market. They belong under
          // Pelanggan and not under Pesanan: an abandoned checkout is a PERSON you can still call,
          // not an order you can fulfil.
          { label: "Keranjang Ditinggal", href: "/pelanggan/keranjang" },
          { label: "Segmen", href: "/pelanggan/segmen" },
          { label: "Ulasan", href: "/pelanggan/ulasan" },
        ],
      },
      // Obrolan = shopper ⇄ merchant chat (specs/docs/CHAT_SPEC.md). It sits with Pesanan/Pelanggan
      // because that is the axis it belongs to — Bantuan (merchant ⇄ platform) deliberately stays
      // at the bottom, a different axis entirely.
      { label: "Obrolan", href: "/obrolan", icon: MessageSquare },
      {
        label: "CRM", href: "/crm", icon: MessagesSquare,
        children: [
          { label: "Follow-up WA", href: "/crm/followup" },
          { label: "Pipeline", href: "/crm/pipeline" },
          { label: "Template", href: "/crm/template" },
        ],
      },
      { label: "Diskon", href: "/diskon", icon: TicketPercent },
      { label: "Analitik", href: "/analitik", icon: BarChart3 },
      { label: "Pemasaran", href: "/pemasaran", icon: Megaphone },
    ],
  },
  {
    label: "Toko Online",
    items: [
      { label: "Tema", href: "/tema", icon: Palette },
      { label: "Halaman", href: "/halaman", icon: FileText },
      { label: "Blog", href: "/blog", icon: Newspaper },
      { label: "Files", href: "/files", icon: FolderOpen },
      { label: "Navigasi", href: "/navigasi", icon: ListTree },
    ],
  },
  {
    items: [
      { label: "Bantuan", href: "/bantuan", icon: LifeBuoy },
      { label: "Pengaturan", href: "/pengaturan", icon: Settings },
    ],
  },
];

// Fallback only — the topbar shows the real session store; STORES[0].plan is a default tier.
export const STORES = [
  { id: "s1", name: "Toko", plan: "Bisnis" },
  { id: "s2", name: "Kopi Senja", plan: "Pemula" },
  { id: "s3", name: "GadgetKu Store", plan: "Bisnis" },
];
