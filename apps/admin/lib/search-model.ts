// The Seller search palette's brain, kept PURE (no React, no DOM, no DB) so every rule is unit-tested:
// folding, ranking, grouping with caps, highlight splitting, the recent-items store (with a storage that
// may throw), and the capability-filtered quick actions. `command-palette.tsx` only renders what this
// module decides.
import type { LucideIcon } from "lucide-react";
import { can, type Capability, type Role } from "@/lib/rbac-policy";
import type { NavGroup } from "@/lib/nav";

// ── what the server hands the palette ─────────────────────────────────────────────────────────────
// Lean on purpose: it rides on every admin page render. Optional fields are DISPLAY details the query
// really has (`lib/data/search.ts`); the palette never invents one.
export type SearchItem = {
  id: string;
  label: string;
  sub: string;
  href: string;
  type: "produk" | "pesanan" | "pelanggan";
  /** Searchable but not shown (e.g. a customer's phone digits). */
  keywords?: string;
  meta?: SearchMeta;
};
export type SearchMeta =
  | { kind: "produk"; priceIdr: number; draft: boolean }
  | { kind: "pesanan"; status: string; totalIdr: number }
  | { kind: "pelanggan"; ordersCount: number };

// ── rows ──────────────────────────────────────────────────────────────────────────────────────────
export type RowKind = "halaman" | "produk" | "pesanan" | "pelanggan" | "aksi" | "terakhir" | "semua";
export type Row = {
  id: string;
  kind: RowKind;
  label: string;
  sub?: string;
  href: string;
  /** Page rows carry their sidebar icon (children inherit the parent's). */
  icon?: LucideIcon;
  meta?: SearchMeta;
  /** Extra searchable words that are not displayed (synonyms for a page, phone digits for a customer). */
  keywords?: string;
  /** For a recent row: what it was when it was opened. */
  recentKind?: Exclude<RowKind, "aksi" | "terakhir" | "semua">;
};

export type GroupKey = "Terakhir dibuka" | "Aksi cepat" | "Halaman populer" | "Halaman" | "Pesanan" | "Produk" | "Pelanggan" | "Lainnya";

// ── folding ───────────────────────────────────────────────────────────────────────────────────────
/**
 * Lower-case and strip diacritics ONE UTF-16 UNIT AT A TIME, so the folded string has exactly the length
 * of the original and an index in one is an index in the other (that is what lets us highlight the match
 * in the original text). "É" → "e"; anything that does not fold to a single unit is kept as lower-case.
 */
export function fold(s: string): string {
  let out = "";
  for (const ch of s) {
    const base = ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    out += base.length === ch.length ? base : ch.toLowerCase().length === ch.length ? ch.toLowerCase() : ch;
  }
  return out;
}

export function tokenize(q: string): string[] {
  return fold(q).split(/\s+/).filter(Boolean);
}

// ── page rows from the sidebar ────────────────────────────────────────────────────────────────────
// Synonyms an Indonesian seller actually types for a page ("kupon" for Voucher, "tarik" for Saldo). Keyed
// by href so the labels in `nav.ts` stay the single source of truth. Additive: a page without an entry
// is found by its label alone.
const PAGE_ALIASES: Record<string, string> = {
  "/": "beranda ringkasan home",
  "/pesanan": "order orderan pembelian kirim resi",
  "/pesanan?tab=perlu_dikirim": "order dikemas packing resi",
  "/pesanan/massal": "bulk cetak label resi",
  "/pesanan?tab=pengembalian": "retur refund batal komplain",
  "/keuangan": "uang omzet pendapatan",
  "/keuangan/penghasilan": "pendapatan income",
  "/saldo": "tarik penarikan withdraw dana rekening",
  "/produk": "barang item sku stok katalog",
  "/produk/kategori": "koleksi collection",
  "/produk/inventori": "stok gudang",
  "/produk/pembelian": "po supplier restock",
  "/pelanggan": "customer pembeli konsumen",
  "/pelanggan/keranjang": "abandoned checkout tinggal",
  "/pelanggan/ulasan": "review rating",
  "/obrolan": "chat percakapan pesan",
  "/crm": "follow up prospek",
  "/diskon": "kupon kode promo potongan",
  "/flash-sale": "kilat promo",
  "/promo": "landing funnel",
  "/affiliate": "komisi referral mitra",
  "/analitik": "laporan statistik grafik",
  "/pemasaran": "iklan marketing pixel",
  "/tema": "desain tampilan template",
  "/halaman": "page konten",
  "/blog": "artikel tulisan",
  "/files": "gambar media upload",
  "/navigasi": "menu",
  "/bantuan": "help cs support kontak",
  "/pengaturan": "setelan profil toko rekening pajak ppn domain kurir cod retur pengaduan pengguna notifikasi",
};

/** The sidebar flattened once into jump-to-page rows ("Parent › Child"); children reuse the parent's icon. */
export function buildNavRows(groups: NavGroup[]): Row[] {
  const rows: Row[] = [];
  const seen = new Set<string>();
  const add = (r: Row) => {
    const k = r.href + "|" + r.label;
    if (seen.has(k)) return;
    seen.add(k);
    rows.push(r);
  };
  for (const g of groups) {
    for (const item of g.items) {
      add({ id: "nav:" + item.href, kind: "halaman", label: item.label, href: item.href, icon: item.icon, keywords: PAGE_ALIASES[item.href] });
      for (const c of item.children ?? []) {
        add({ id: "navc:" + c.href + c.label, kind: "halaman", label: `${item.label} › ${c.label}`, href: c.href, icon: item.icon, keywords: PAGE_ALIASES[c.href] });
      }
    }
  }
  return rows;
}

// ── scoring ───────────────────────────────────────────────────────────────────────────────────────
function tokenScore(token: string, label: string, rest: string): number {
  if (label === token) return 100;
  if (label.startsWith(token)) return 80;
  if (new RegExp("(^|[^a-z0-9])" + token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(label)) return 65;
  if (label.includes(token)) return 45;
  if (new RegExp("(^|[^a-z0-9])" + token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(rest)) return 30;
  if (rest.includes(token)) return 15;
  return 0;
}

/** 0 = no match. Every token must hit somewhere (AND), so "batik merah" finds only what has both words. */
export function scoreRow(row: Pick<Row, "label" | "sub" | "keywords">, tokens: string[]): number {
  if (!tokens.length) return 0;
  const label = fold(row.label);
  const rest = fold([row.sub ?? "", row.keywords ?? ""].join(" "));
  let total = 0;
  for (const t of tokens) {
    const s = tokenScore(t, label, rest);
    if (s === 0) return 0;
    total += s;
  }
  // Shorter labels first on a tie: "Produk" before "Produk › Inventori" for the query "produk".
  return total + Math.max(0, 10 - Math.floor(label.length / 6));
}

// ── ranking + grouping with caps ──────────────────────────────────────────────────────────────────
export const GROUP_CAP = 5;

export type ResultGroup = { key: GroupKey; rows: Row[]; total: number; hidden: number };

export type Ranked = {
  groups: ResultGroup[];
  /** Every selectable row, in rendered order — `active` indexes into this. */
  flat: Row[];
  /** True when the query hit nothing in the local index. */
  empty: boolean;
};

const KIND_GROUP: Partial<Record<RowKind, GroupKey>> = { halaman: "Halaman", produk: "Produk", pesanan: "Pesanan", pelanggan: "Pelanggan" };
const DEFAULT_GROUP_ORDER: GroupKey[] = ["Pesanan", "Produk", "Pelanggan", "Halaman"];

/** The index → rows, once (not per keystroke). */
export function indexRows(index: SearchItem[]): Row[] {
  return index.map<Row>((i) => ({ id: i.type + ":" + i.id, kind: i.type, label: i.label, sub: i.sub || undefined, href: i.href, meta: i.meta, keywords: i.keywords }));
}

/**
 * The "search all orders" escape hatch. The index holds the 80 newest orders only, so an older order
 * number must still be reachable: this row goes to the real list with `?q=`, and it is offered for ANY
 * non-empty query (also when there are hits), as the last row.
 */
export function searchAllOrdersRow(q: string): Row {
  return { id: "semua:pesanan", kind: "semua", label: `Cari “${q.trim()}” di semua pesanan`, sub: "Daftar pesanan lengkap, termasuk yang lama", href: `/pesanan?q=${encodeURIComponent(q.trim())}` };
}

export function rank(q: string, pages: Row[], data: Row[]): Ranked {
  const tokens = tokenize(q);
  if (!tokens.length) return { groups: [], flat: [], empty: false };
  const scored = (rows: Row[]) =>
    rows
      .map((r, i) => ({ r, i, s: scoreRow(r, tokens) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.i - b.i);
  const byGroup = new Map<GroupKey, { r: Row; s: number }[]>();
  for (const x of [...scored(pages), ...scored(data)]) {
    const g = KIND_GROUP[x.r.kind] ?? "Lainnya";
    const l = byGroup.get(g) ?? [];
    l.push({ r: x.r, s: x.s });
    byGroup.set(g, l);
  }
  // Groups ordered by their best hit, ties by the default order (orders first: a seller types an order
  // number far more often than a page name, and a number never matches a page).
  const keys = [...byGroup.keys()].sort((a, b) => {
    const d = byGroup.get(b)![0].s - byGroup.get(a)![0].s;
    return d || DEFAULT_GROUP_ORDER.indexOf(a) - DEFAULT_GROUP_ORDER.indexOf(b);
  });
  const groups: ResultGroup[] = keys.map((key) => {
    const all = byGroup.get(key)!;
    return { key, rows: all.slice(0, GROUP_CAP).map((x) => x.r), total: all.length, hidden: Math.max(0, all.length - GROUP_CAP) };
  });
  const flat = groups.flatMap((g) => g.rows);
  return { groups, flat, empty: flat.length === 0 };
}

// ── highlight ─────────────────────────────────────────────────────────────────────────────────────
export type Part = { text: string; hit: boolean };

/** Split `text` into parts, marking every region any token matches (accent- and case-insensitive). */
export function splitHighlight(text: string, tokens: string[]): Part[] {
  if (!text) return [];
  if (!tokens.length) return [{ text, hit: false }];
  const f = fold(text);
  const mark = new Array<boolean>(text.length).fill(false);
  for (const t of tokens) {
    if (!t) continue;
    let from = 0;
    for (;;) {
      const at = f.indexOf(t, from);
      if (at < 0) break;
      for (let k = at; k < at + t.length; k++) mark[k] = true;
      from = at + Math.max(1, t.length);
    }
  }
  const parts: Part[] = [];
  let cur = "";
  let curHit = mark[0];
  for (let k = 0; k < text.length; k++) {
    if (mark[k] !== curHit) {
      parts.push({ text: cur, hit: curHit });
      cur = "";
      curHit = mark[k];
    }
    cur += text[k];
  }
  parts.push({ text: cur, hit: curHit });
  return parts;
}

// ── recent items ──────────────────────────────────────────────────────────────────────────────────
export const RECENT_CAP = 6;
export const recentKey = (slug: string) => `tphi-admin-recent:${slug || "default"}`;

export type Recent = { kind: NonNullable<Row["recentKind"]>; id: string; label: string; sub?: string; href: string };
type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** An internal admin path only. localStorage is user-editable, and `router.push` must never receive anything else. */
export const isInternalHref = (h: unknown): h is string => typeof h === "string" && /^\/(?!\/)[^\s\\]*$/.test(h) && h.length <= 300;

const KINDS = new Set(["halaman", "produk", "pesanan", "pelanggan"]);
const clean = (x: unknown): Recent | null => {
  if (!x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.label !== "string" || !KINDS.has(r.kind as string) || !isInternalHref(r.href)) return null;
  return { kind: r.kind as Recent["kind"], id: r.id.slice(0, 120), label: r.label.slice(0, 120), sub: typeof r.sub === "string" ? r.sub.slice(0, 120) : undefined, href: r.href };
};

/** Never throws: a blocked, full or corrupt storage is just "no recents". */
export function loadRecents(storage: StorageLike | null | undefined, key: string): Recent[] {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return [];
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map(clean).filter((r): r is Recent => r !== null).slice(0, RECENT_CAP);
  } catch {
    return [];
  }
}

/** Most recent first, one entry per href, capped. Returns the new list even when saving fails. */
export function pushRecent(storage: StorageLike | null | undefined, key: string, item: Recent): Recent[] {
  const next = [item, ...loadRecents(storage, key).filter((r) => r.href !== item.href)].map(clean).filter((r): r is Recent => r !== null).slice(0, RECENT_CAP);
  try {
    storage?.setItem(key, JSON.stringify(next));
  } catch {
    /* private mode / quota: the palette works without memory */
  }
  return next;
}

export function recentRows(recents: Recent[], navIcons: Map<string, LucideIcon>): Row[] {
  return recents.map<Row>((r) => ({ id: "recent:" + r.href, kind: "terakhir", recentKind: r.kind, label: r.label, sub: r.sub, href: r.href, icon: r.kind === "halaman" ? navIcons.get(r.href) : undefined }));
}

// ── quick actions (only routes that exist, only for roles that may use them) ─────────────────────
export type QuickAction = { id: string; label: string; sub: string; href: string; cap?: Capability; iconKey: "produk" | "voucher" | "kirim" | "massal" | "blog" | "flash" };

export const QUICK_ACTIONS: QuickAction[] = [
  { id: "qa:produk", label: "Tambah produk", sub: "Produk baru", href: "/produk/baru", cap: "products:write", iconKey: "produk" },
  { id: "qa:voucher", label: "Buat voucher", sub: "Kode diskon baru", href: "/diskon/baru", cap: "discounts:write", iconKey: "voucher" },
  { id: "qa:kirim", label: "Pesanan perlu dikirim", sub: "Antrean paket yang harus dikemas", href: "/pesanan?tab=perlu_dikirim", iconKey: "kirim" },
  { id: "qa:massal", label: "Pengiriman massal", sub: "Atur dan cetak banyak resi sekaligus", href: "/pesanan/massal", cap: "orders:write", iconKey: "massal" },
  { id: "qa:blog", label: "Tulis artikel", sub: "Blog toko", href: "/blog/baru", cap: "content:write", iconKey: "blog" },
  { id: "qa:flash", label: "Buat flash sale", sub: "Promo berbatas waktu", href: "/flash-sale/baru", cap: "discounts:write", iconKey: "flash" },
];

/** The role decides, and an unknown or missing role fails CLOSED (`can()` is false): it keeps only the actions with no capability. UX only — the server action is the boundary. */
export function quickActionsFor(role: Role | string | undefined): QuickAction[] {
  return QUICK_ACTIONS.filter((a) => !a.cap || can(role, a.cap));
}

/** Pages worth offering on an empty query: the few a seller opens daily, not all 35. */
export const POPULAR_HREFS = ["/", "/pesanan?tab=perlu_dikirim", "/produk", "/pelanggan", "/keuangan", "/pengaturan"];

export function popularPages(pages: Row[]): Row[] {
  return POPULAR_HREFS.map((h) => pages.find((p) => p.href === h)).filter((r): r is Row => !!r);
}

/** What the live region says. */
export function resultAnnouncement(q: string, ranked: Ranked, emptyCount: number): string {
  if (!q.trim()) return emptyCount > 0 ? `${emptyCount} pilihan tersedia` : "";
  if (ranked.empty) return `Tidak ada hasil untuk ${q.trim()}`;
  return `${ranked.flat.length} hasil`;
}
