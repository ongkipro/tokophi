// Storefront catalog (self-contained mock — mirrors the admin fashion demo).
// Later: share via packages/data (see TASKS E3).

export const STORE = {
  name: "Batik Nusantara",
  tagline: "Busana wanita modern — batik & ready-to-wear",
  whatsapp: "6281234567890",
  city: "Yogyakarta",
};

export type Collection = { handle: string; name: string; emoji: string; blurb: string };
export const COLLECTIONS: Collection[] = [
  { handle: "dress", name: "Dress", emoji: "👗", blurb: "Dress harian sampai acara spesial" },
  { handle: "atasan", name: "Atasan", emoji: "👚", blurb: "Blouse, kemeja, & tunik" },
  { handle: "bawahan", name: "Bawahan", emoji: "👖", blurb: "Rok & celana kulot" },
  { handle: "busana-muslim", name: "Busana Muslim", emoji: "🧕", blurb: "Hijab, khimar, & gamis" },
  { handle: "outerwear", name: "Outerwear", emoji: "🧥", blurb: "Cardigan & blazer" },
  { handle: "loungewear", name: "Loungewear", emoji: "🩱", blurb: "Nyaman untuk di rumah" },
];

export type Product = {
  handle: string;
  name: string;
  price: number;
  compareAt?: number;
  category: string;
  categoryHandle: string;
  image: string;
  description: string;
  sizes: string[];
  badge?: string;
  bestseller?: boolean;
};

export const PRODUCTS: Product[] = [
  { handle: "dress-midi-bunga", name: "Dress Midi Motif Bunga", price: 189000, compareAt: 249000, category: "Dress", categoryHandle: "dress", image: "/products/dress-midi-bunga.webp", description: "Dress midi bahan adem dengan motif bunga pastel. Potongan flowy yang anggun untuk hangout maupun acara semi-formal.", sizes: ["S", "M", "L", "XL"], badge: "Promo", bestseller: true },
  { handle: "blouse-katun", name: "Blouse Katun Lengan Balon", price: 95000, category: "Atasan", categoryHandle: "atasan", image: "/products/blouse-katun.webp", description: "Blouse katun premium dengan lengan balon yang manis. Ringan, adem, dan mudah dipadupadankan.", sizes: ["S", "M", "L"], bestseller: true },
  { handle: "kemeja-oversized", name: "Kemeja Oversized Wanita", price: 120000, category: "Atasan", categoryHandle: "atasan", image: "/products/kemeja-oversized.webp", description: "Kemeja oversized warna soft, tampil effortless dan kekinian. Cocok untuk gaya kasual maupun kerja.", sizes: ["M", "L", "XL"] },
  { handle: "rok-plisket", name: "Rok Plisket Panjang", price: 89000, category: "Bawahan", categoryHandle: "bawahan", image: "/products/rok-plisket.webp", description: "Rok plisket panjang yang jatuh cantik saat bergerak. Pinggang karet, nyaman dipakai seharian.", sizes: ["All Size"] },
  { handle: "celana-kulot", name: "Celana Kulot Wide Leg", price: 110000, category: "Bawahan", categoryHandle: "bawahan", image: "/products/celana-kulot.webp", description: "Kulot wide leg warna netral, memberi kesan tinggi dan rapi. Bahan tidak menerawang.", sizes: ["S", "M", "L", "XL"] },
  { handle: "hijab-voal", name: "Hijab Voal Segi Empat", price: 45000, category: "Busana Muslim", categoryHandle: "busana-muslim", image: "/products/hijab-voal.webp", description: "Hijab voal ultrafine, jatuh sempurna dan tidak licin. Tersedia warna-warna pastel favorit.", sizes: ["115x115 cm"], bestseller: true },
  { handle: "khimar-instan", name: "Khimar Instan Jumbo", price: 75000, category: "Busana Muslim", categoryHandle: "busana-muslim", image: "/products/khimar-instan.webp", description: "Khimar instan jumbo, praktis langsung pakai dengan pet antem. Menutup sempurna dan adem.", sizes: ["All Size"] },
  { handle: "gamis-syari", name: "Gamis Syari Polos", price: 245000, category: "Busana Muslim", categoryHandle: "busana-muslim", image: "/products/gamis-syari.webp", description: "Gamis syari polos bahan wollycrepe yang jatuh dan tidak kaku. Elegan untuk sehari-hari maupun acara.", sizes: ["S", "M", "L", "XL"] },
  { handle: "tunik-rayon", name: "Tunik Katun Rayon", price: 98000, category: "Atasan", categoryHandle: "atasan", image: "/products/tunik-rayon.webp", description: "Tunik rayon adem dengan panjang menutup pinggul. Warna mustard yang hangat dan mudah dipadukan.", sizes: ["M", "L", "XL"] },
  { handle: "cardigan-rajut", name: "Cardigan Rajut Wanita", price: 135000, category: "Outerwear", categoryHandle: "outerwear", image: "/products/cardigan-rajut.webp", description: "Cardigan rajut lembut warna oatmeal. Cocok jadi outer manis untuk berbagai outfit.", sizes: ["All Size"] },
  { handle: "piyama-satin", name: "Set Piyama Satin Wanita", price: 125000, category: "Loungewear", categoryHandle: "loungewear", image: "/products/piyama-satin.webp", description: "Set piyama satin halus warna sage. Mewah dan nyaman untuk tidur maupun santai di rumah.", sizes: ["M", "L", "XL"] },
  { handle: "blazer-wanita", name: "Blazer Formal Wanita", price: 199000, category: "Outerwear", categoryHandle: "outerwear", image: "/products/blazer-wanita.webp", description: "Blazer tailored hitam yang menegaskan siluet. Wajib punya untuk tampilan profesional.", sizes: ["S", "M", "L"] },
  { handle: "dress-batik", name: "Dress Batik Modern", price: 215000, compareAt: 275000, category: "Dress", categoryHandle: "dress", image: "/products/dress-batik.webp", description: "Dress batik motif modern hasil kolaborasi pengrajin lokal. Anggun, berkelas, dan bernilai budaya.", sizes: ["S", "M", "L", "XL"], badge: "Signature" },
  { handle: "jumpsuit-kulot", name: "Jumpsuit Kulot Casual", price: 175000, category: "Dress", categoryHandle: "dress", image: "/products/jumpsuit-kulot.webp", description: "Jumpsuit kulot warna terracotta, satu set praktis yang tetap stylish. Nyaman untuk jalan seharian.", sizes: ["M", "L"] },
];

// Each product has a 5-image gallery: base + -2..-5 (AI-generated catalog shots).
export const productImages = (p: Product): string[] => [
  p.image,
  ...[2, 3, 4, 5].map((n) => p.image.replace(/\.webp$/, `-${n}.webp`)),
];

export const bestsellers = () => PRODUCTS.filter((p) => p.bestseller);
export const byCollection = (handle: string) => PRODUCTS.filter((p) => p.categoryHandle === handle);
export const findProduct = (handle: string) => PRODUCTS.find((p) => p.handle === handle);
export const findCollection = (handle: string) => COLLECTIONS.find((c) => c.handle === handle);
