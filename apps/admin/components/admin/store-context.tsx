"use client";
import { createContext, useContext } from "react";

// The current store's name, provided once by the admin layout (from the session store) so any
// client component can show it — instead of hardcoding "Batik Nusantara". Reflects impersonation.
const StoreNameContext = createContext<string>("Toko");

export function StoreProvider({ name, children }: { name: string; children: React.ReactNode }) {
  return <StoreNameContext.Provider value={name}>{children}</StoreNameContext.Provider>;
}

export function useStoreName(): string {
  return useContext(StoreNameContext);
}
