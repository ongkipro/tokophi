import type { NavItemType } from "@/lib/mock/store";
import {
  Home,
  Grid2x2,
  Package,
  FileText,
  Newspaper,
  Link2,
  type LucideIcon,
} from "lucide-react";

// Maps each NavItemType to its Indonesian label + icon (mirrors Shopify's MenuItemType).
export const TYPE_META: Record<NavItemType, { label: string; icon: LucideIcon }> = {
  beranda: { label: "Beranda", icon: Home },
  koleksi: { label: "Koleksi", icon: Grid2x2 },
  produk: { label: "Produk", icon: Package },
  halaman: { label: "Halaman", icon: FileText },
  blog: { label: "Blog", icon: Newspaper },
  url: { label: "Tautan web", icon: Link2 },
};

export const TYPE_OPTIONS: NavItemType[] = [
  "beranda",
  "koleksi",
  "produk",
  "halaman",
  "blog",
  "url",
];

// Sensible default target hint per type, shown as the input placeholder.
export const TARGET_PLACEHOLDER: Record<NavItemType, string> = {
  beranda: "/",
  koleksi: "/kategori/nama-koleksi",
  produk: "/produk/nama-produk",
  halaman: "/halaman/nama-halaman",
  blog: "/blog/nama-blog",
  url: "https://",
};
