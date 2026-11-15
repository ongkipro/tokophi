"use client";
import { createContext, useContext } from "react";

// The current store's name + URL slug, provided once by the admin layout (from the session store)
// so any client component can show the name or build /store/{slug}/… links. Reflects impersonation.
const StoreNameContext = createContext<string>("Toko");
const StoreSlugContext = createContext<string>("");
// TokoΦ Account (ADR 0016) ON/OFF, decided on the SERVER by the admin layout (`buyerAccountEnabled()`);
// default false = dormant, so a component rendered outside the provider never shows the buyer surfaces.
const BuyerAccountsContext = createContext<boolean>(false);

export function StoreProvider({ name, slug = "", buyerAccounts = false, children }: { name: string; slug?: string; buyerAccounts?: boolean; children: React.ReactNode }) {
  return (
    <StoreNameContext.Provider value={name}>
      <StoreSlugContext.Provider value={slug}>
        <BuyerAccountsContext.Provider value={buyerAccounts}>{children}</BuyerAccountsContext.Provider>
      </StoreSlugContext.Provider>
    </StoreNameContext.Provider>
  );
}

export function useBuyerAccountsEnabled(): boolean {
  return useContext(BuyerAccountsContext);
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
