"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Toaster } from "sonner";

// Full-bleed routes hide the sidebar/topbar/billing-banner chrome entirely — Puck needs the whole
// viewport, and its own toolbar replaces the topbar.
//
// ⚠️ These are ROUTES, not PREFIXES, and the difference was a real bug. This was
// `["/tema"]` + `startsWith`, and `"/tema".startsWith("/tema")` is true — so the template LIST went
// full-bleed too and lost its sidebar AND topbar. The seller landed on a page with no navigation of
// any kind and no way back out except the browser's own back button. Reported as "back from the
// editor is broken"; it was never about going back at all — /tema was broken on plain load, and the
// prefix had swallowed its own parent.
//
// Match the builder EXACTLY: one segment after /tema (the template id), never /tema itself.
// If you add a full-bleed route, add a regex — not a prefix. A prefix always eats the index page.
const FULL_BLEED = [/^\/tema\/[^/]+$/];

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
  const isFullBleed = FULL_BLEED.some((re) => re.test(pathname ?? ""));

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
