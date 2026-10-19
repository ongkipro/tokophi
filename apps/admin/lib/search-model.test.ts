import { describe, expect, it } from "vitest";
import { Package, ShoppingBag } from "lucide-react";
import type { NavGroup } from "@/lib/nav";
import {
  GROUP_CAP, QUICK_ACTIONS, RECENT_CAP, buildNavRows, fold, indexRows, isInternalHref, loadRecents, popularPages, pushRecent, quickActionsFor,
  rank, recentKey, recentRows, resultAnnouncement, scoreRow, searchAllOrdersRow, splitHighlight, tokenize, type Recent, type Row, type SearchItem,
} from "./search-model";

// The palette's rules, off the screen. Every behaviour a seller feels — what ranks first, what is
// highlighted, what the empty state offers, what survives a broken localStorage — is decided here.

const NAV: NavGroup[] = [
  {
    items: [
      { label: "Dashboard", href: "/", icon: Package },
      { label: "Pesanan", href: "/pesanan?tab=perlu_dikirim", icon: ShoppingBag, children: [{ label: "Pesanan Saya", href: "/pesanan" }, { label: "Pengiriman Massal", href: "/pesanan/massal" }] },
      { label: "Produk", href: "/produk", icon: Package, children: [{ label: "Inventori", href: "/produk/inventori" }] },
    ],
  },
];

const item = (type: SearchItem["type"], id: string, label: string, sub = "", extra: Partial<SearchItem> = {}): SearchItem => ({ id, type, label, sub, href: `/${type}/${id}`, ...extra });

describe("folding and tokens", () => {
  it("lower-cases and strips accents without changing the length (so a match index maps back to the original)", () => {
    for (const s of ["Café Écru", "ÀÉÎÕÜ", "Batik Nusantara", "Rp 1.000", "İstanbul", "naïve"]) expect(fold(s).length).toBe(s.length);
    expect(fold("Café Écru")).toBe("cafe ecru");
  });
  it("tokenizes on whitespace and drops empties", () => {
    expect(tokenize("  Batik   MERAH ")).toEqual(["batik", "merah"]);
    expect(tokenize("   ")).toEqual([]);
  });
});

describe("page rows from the sidebar", () => {
  const rows = buildNavRows(NAV);
  it("flattens parents and children as 'Parent › Child' and children reuse the parent's icon", () => {
    expect(rows.map((r) => r.label)).toEqual(["Dashboard", "Pesanan", "Pesanan › Pesanan Saya", "Pesanan › Pengiriman Massal", "Produk", "Produk › Inventori"]);
    expect(rows.find((r) => r.label === "Pesanan › Pesanan Saya")!.icon).toBe(ShoppingBag);
    expect(rows.find((r) => r.label === "Produk › Inventori")!.icon).toBe(Package);
    expect(rows.every((r) => r.kind === "halaman" && !!r.icon)).toBe(true);
  });
  it("carries synonyms a seller really types (kupon, tarik, resi) so a page is found by more than its label", () => {
    const r = buildNavRows(NAV);
    expect(rank("resi", r, []).flat.map((x) => x.label)).toContain("Pesanan › Pengiriman Massal");
  });
  it("does not list the same page twice", () => {
    const dup: NavGroup[] = [{ items: [{ label: "A", href: "/a", icon: Package }, { label: "A", href: "/a", icon: Package }] }];
    expect(buildNavRows(dup)).toHaveLength(1);
  });
});

describe("scoring", () => {
  const s = (label: string, q: string, sub?: string, keywords?: string) => scoreRow({ label, sub, keywords }, tokenize(q));
  it("ranks exact > prefix > word start > contains > subtitle", () => {
    const exact = s("Produk", "produk");
    const prefix = s("Produk Baru", "produk");
    const word = s("Tambah Produk", "produk");
    const contains = s("Subproduk", "produk");
    const sub = s("Kemeja", "produk", "Produk lain");
    expect([exact, prefix, word, contains, sub].every((x) => x > 0)).toBe(true);
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(contains);
    expect(contains).toBeGreaterThan(sub);
  });
  it("needs EVERY token to hit (AND), in label or subtitle/keywords", () => {
    expect(s("Kemeja Batik", "batik merah")).toBe(0);
    expect(s("Kemeja Batik", "batik merah", "warna merah")).toBeGreaterThan(0);
    expect(s("Rina Hijab", "0812", "x", "6281234 0812345")).toBeGreaterThan(0);
  });
  it("is accent- and case-insensitive; a query with no tokens scores 0", () => {
    expect(s("Café Ècru", "CAFE")).toBeGreaterThan(0);
    expect(s("Café", "")).toBe(0);
  });
  it("treats regex characters in the query as text, not syntax", () => {
    expect(() => s("Rp (10)", "(")).not.toThrow();
    expect(s("Rp (10)", "(")).toBeGreaterThan(0);
    expect(s("Rp 10", "(")).toBe(0);
  });
});

describe("ranking, grouping and caps", () => {
  const pages = buildNavRows(NAV);
  const orders = Array.from({ length: 8 }, (_, i) => item("pesanan", `PHI-${100 + i}`, `PHI-${100 + i}`, "Sari"));
  const data = indexRows([...orders, item("produk", "p1", "Kemeja Batik", "#1042 · Atasan"), item("pelanggan", "c1", "Sari Dewi", "sari@x.id", { keywords: "6281234567 081234567" })]);

  it("caps each group at 5 and says how many are hidden", () => {
    const r = rank("phi", pages, data);
    const g = r.groups.find((x) => x.key === "Pesanan")!;
    expect(GROUP_CAP).toBe(5);
    expect(g.rows).toHaveLength(5);
    expect(g.total).toBe(8);
    expect(g.hidden).toBe(3);
  });
  it("orders groups by their best hit: an order number puts Pesanan first, a page name puts Halaman first", () => {
    expect(rank("phi-103", pages, data).groups[0].key).toBe("Pesanan");
    expect(rank("dashboard", pages, data).groups[0].key).toBe("Halaman");
  });
  it("finds a customer by the phone as typed locally or canonically, without the phone being a visible field", () => {
    expect(rank("081234567", pages, data).flat.map((r) => r.label)).toContain("Sari Dewi");
    expect(rank("628123", pages, data).flat.map((r) => r.label)).toContain("Sari Dewi");
    expect(data.find((r) => r.label === "Sari Dewi")!.sub).toBe("sari@x.id");
  });
  it("finds a product by its catalog number in the subtitle", () => {
    expect(rank("1042", pages, data).flat.map((r) => r.label)).toEqual(["Kemeja Batik"]);
  });
  it("`flat` is exactly the rendered order, so an active index maps to one row", () => {
    const r = rank("sari", pages, data);
    expect(r.flat).toEqual(r.groups.flatMap((g) => g.rows));
  });
  it("reports empty, and offers the full-order-list escape hatch with the query encoded", () => {
    expect(rank("zzzzqq", pages, data).empty).toBe(true);
    expect(rank("   ", pages, data)).toEqual({ groups: [], flat: [], empty: false });
    const all = searchAllOrdersRow("  PHI 1/2&x ");
    expect(all.kind).toBe("semua");
    expect(all.href).toBe("/pesanan?q=PHI%201%2F2%26x");
    expect(all.label).toContain("PHI 1/2&x");
  });
});

describe("highlight", () => {
  const joined = (t: string, q: string) => splitHighlight(t, tokenize(q)).map((p) => p.text).join("");
  it("marks every region a token matches, accent- and case-insensitively, and never alters the text", () => {
    expect(splitHighlight("Kemeja Batik Merah", ["batik"])).toEqual([{ text: "Kemeja ", hit: false }, { text: "Batik", hit: true }, { text: " Merah", hit: false }]);
    expect(splitHighlight("Café Crème", ["cafe", "creme"]).filter((p) => p.hit).map((p) => p.text)).toEqual(["Café", "Crème"]);
    for (const [t, q] of [["Kemeja Batik", "ba"], ["Rp 10.000 (x)", "( 10"], ["aaaa", "aa"], ["Café", "É"]] as const) expect(joined(t, q)).toBe(t);
  });
  it("merges overlapping or adjacent matches and handles no match / empty input", () => {
    expect(splitHighlight("batikbatik", ["batik"])).toEqual([{ text: "batikbatik", hit: true }]);
    expect(splitHighlight("abc", ["zz"])).toEqual([{ text: "abc", hit: false }]);
    expect(splitHighlight("abc", [])).toEqual([{ text: "abc", hit: false }]);
    expect(splitHighlight("", ["a"])).toEqual([]);
  });
});

describe("recent items", () => {
  const mk = (n: number): Recent => ({ kind: "produk", id: `p${n}`, label: `Produk ${n}`, sub: "x", href: `/produk/${n}` });
  const memory = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
  };
  const broken = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("QuotaExceededError"); } };

  it("is per store, most recent first, one entry per href, capped", () => {
    expect(recentKey("batik")).not.toBe(recentKey("kopi"));
    const st = memory();
    for (let i = 1; i <= RECENT_CAP + 3; i++) pushRecent(st, "k", mk(i));
    const list = loadRecents(st, "k");
    expect(list).toHaveLength(RECENT_CAP);
    expect(list[0].href).toBe(`/produk/${RECENT_CAP + 3}`);
    pushRecent(st, "k", mk(RECENT_CAP + 1)); // reopen an older one: it moves to the top, no duplicate
    const again = loadRecents(st, "k");
    expect(again[0].href).toBe(`/produk/${RECENT_CAP + 1}`);
    expect(new Set(again.map((r) => r.href)).size).toBe(again.length);
  });
  it("never throws when localStorage is blocked or full; the palette simply has no memory", () => {
    expect(loadRecents(broken, "k")).toEqual([]);
    expect(() => pushRecent(broken, "k", mk(1))).not.toThrow();
    expect(pushRecent(broken, "k", mk(1))).toEqual([mk(1)]);
    expect(loadRecents(null, "k")).toEqual([]);
    expect(loadRecents(undefined, "k")).toEqual([]);
  });
  it("survives corrupt storage and drops tampered entries — router.push must only ever get an internal path", () => {
    const st = memory();
    st.setItem("k", "{not json");
    expect(loadRecents(st, "k")).toEqual([]);
    st.setItem("k", JSON.stringify({ a: 1 }));
    expect(loadRecents(st, "k")).toEqual([]);
    st.setItem("k", JSON.stringify([
      mk(1),
      { ...mk(2), href: "javascript:alert(1)" },
      { ...mk(3), href: "//evil.example/x" },
      { ...mk(4), href: "https://evil.example" },
      { ...mk(5), kind: "hack" },
      { id: "x" },
      null,
      "str",
    ]));
    expect(loadRecents(st, "k").map((r) => r.href)).toEqual(["/produk/1"]);
  });
  it("isInternalHref accepts admin paths only", () => {
    for (const ok of ["/", "/produk/12", "/pesanan?tab=perlu_dikirim", "/pesanan?q=a%20b"]) expect(isInternalHref(ok), ok).toBe(true);
    for (const bad of ["//x.com", "http://x.com", "javascript:1", "", "pesanan", "/a b", "/a\\b", 5, null, "/" + "a".repeat(400)]) expect(isInternalHref(bad), String(bad)).toBe(false);
  });
  it("turns into rows that keep the page icon for a page and use the kind for the rest", () => {
    const icons = new Map([["/pesanan", ShoppingBag]]);
    const rows = recentRows([{ kind: "halaman", id: "nav:/pesanan", label: "Pesanan", href: "/pesanan" }, mk(1)], icons);
    expect(rows[0].icon).toBe(ShoppingBag);
    expect(rows[1].icon).toBeUndefined();
    expect(rows.every((r) => r.kind === "terakhir")).toBe(true);
    expect(rows[1].recentKind).toBe("produk");
  });
});

describe("quick actions follow the role", () => {
  const labels = (role?: string) => quickActionsFor(role).map((a) => a.label);
  it("owner and admin see all of them", () => {
    expect(labels("owner")).toHaveLength(QUICK_ACTIONS.length);
    expect(labels("admin")).toHaveLength(QUICK_ACTIONS.length);
  });
  it("a role without the capability does not see the action", () => {
    expect(labels("gudang")).toEqual(["Pesanan perlu dikirim"]); // inventory/purchases only
    expect(labels("cs")).toEqual(["Pesanan perlu dikirim", "Pengiriman massal"]); // orders:write, no catalog or promo
    expect(labels("advertiser")).toEqual(["Buat voucher", "Pesanan perlu dikirim", "Tulis artikel", "Buat flash sale"]); // campaigns, not catalog/orders
    expect(labels("staff")).toEqual(QUICK_ACTIONS.map((a) => a.label));
  });
  it("fails closed for a missing or unknown role: only actions that need no capability", () => {
    for (const role of [undefined, "", "hacker"]) expect(labels(role)).toEqual(["Pesanan perlu dikirim"]);
  });
  it("only points at routes that exist and are internal", () => {
    for (const a of QUICK_ACTIONS) expect(isInternalHref(a.href), a.href).toBe(true);
  });
});

describe("empty state and announcements", () => {
  it("offers a handful of daily pages, not the whole sidebar", () => {
    const pages = buildNavRows(NAV);
    expect(popularPages(pages).map((r) => r.href)).toEqual(["/", "/pesanan?tab=perlu_dikirim", "/produk"]); // only the ones that exist here
    expect(popularPages(pages).length).toBeLessThanOrEqual(6);
  });
  it("tells a screen reader how many results, or that there are none", () => {
    const ranked = rank("sari", [], indexRows([item("pelanggan", "c", "Sari")]));
    expect(resultAnnouncement("sari", ranked, 0)).toBe("1 hasil");
    expect(resultAnnouncement("zz", rank("zz", [], []), 0)).toBe("Tidak ada hasil untuk zz");
    expect(resultAnnouncement("", { groups: [], flat: [], empty: false }, 9)).toBe("9 pilihan tersedia");
  });
});

const _typecheck: Row | undefined = undefined;
void _typecheck;
