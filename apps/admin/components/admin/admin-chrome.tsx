"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Toaster } from "sonner";

// Full-bleed routes (e.g. the Store Builder) hide the sidebar/topbar/billing-banner chrome
// entirely — Puck needs the whole viewport, and its own toolbar replaces the topbar.
const FULL_BLEED_PREFIXES = ["/tema"];

export function AdminChrome({
  sidebar,
  topbar,
  billingBanner,
  children,
}: {
  sidebar: React.ReactNode;
  topbar: React.ReactNode;
  billingBanner: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isFullBleed = FULL_BLEED_PREFIXES.some((p) => pathname?.startsWith(p));

  if (isFullBleed) {
    return (
      <div className="flex h-screen w-full flex-col overflow-hidden">
        {children}
        <Toaster position="top-center" richColors closeButton />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full">
      {sidebar}
      <div className="flex min-w-0 flex-1 flex-col">
        {topbar}
        {billingBanner}
        <main className="flex-1 bg-muted/30 p-4 sm:p-6">{children}</main>
      </div>
      <Toaster position="top-center" richColors closeButton />
    </div>
  );
}
