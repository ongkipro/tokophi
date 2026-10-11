export interface MarketingRoute {
  href: string;
  label: string;
  shortLabel?: string;
}

export const MARKETING_ROUTES: readonly MarketingRoute[] = [
  { href: "/fitur/", label: "Fitur" },
  { href: "/harga/", label: "Harga" },
  { href: "/cara-kerja/", label: "Cara kerja" },
  {
    href: "/pembayaran-pengiriman/",
    label: "Bayar dan kirim",
  },
  { href: "/demo/", label: "Demo toko", shortLabel: "Demo" },
] as const;

export function isCurrentRoute(currentPath: string, href: string): boolean {
  if (href === "/") return currentPath === "/";
  return currentPath === href || currentPath.startsWith(href);
}
