"use client";
import { createContext, useContext } from "react";

// The current store's name + URL slug, provided once by the admin layout (from the session store)
// so any client component can show the name or build /store/{slug}/… links. Reflects impersonation.
const StoreNameContext = createContext<string>("Toko");
const StoreSlugContext = createContext<string>("");

export function StoreProvider({ name, slug = "", children }: { name: string; slug?: string; children: React.ReactNode }) {
  return (
    <StoreNameContext.Provider value={name}>
      <StoreSlugContext.Provider value={slug}>{children}</StoreSlugContext.Provider>
    </StoreNameContext.Provider>
  );
}

export function useStoreName(): string {
  return useContext(StoreNameContext);
}

export function useStoreSlug(): string {
  return useContext(StoreSlugContext);
}

// Prefix an internal admin href with the store segment (Shopify-style). "/produk" → "/store/{slug}/produk".
export function useStoreHref(): (href: string) => string {
  const slug = useStoreSlug();
  return (href: string) => (slug ? `/store/${slug}${href === "/" ? "" : href}` : href);
}
