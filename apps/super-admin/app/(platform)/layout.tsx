"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShieldCheck, Store } from "lucide-react";
import { cn } from "@tokophi/ui/lib/utils";
import { Avatar, AvatarFallback } from "@tokophi/ui/avatar";
import { Badge } from "@tokophi/ui/badge";
import { NAV } from "@/lib/nav";

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/") || pathname.startsWith(href);

  const current = NAV.find((n) => isActive(n.href));
  const title = current?.label ?? "Platform";

  return (
    <div className="flex min-h-screen w-full">
      {/* Sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-card md:flex">
        {/* Brand */}
        <div className="flex h-14 items-center gap-2.5 border-b px-4">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Store className="size-4" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold leading-none">TokoΦ</div>
            <div className="mt-1 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
              <ShieldCheck className="size-3 text-primary" /> Super Admin
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {NAV.map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Bottom mini card */}
        <div className="p-3">
          <div className="rounded-xl border bg-gradient-to-br from-primary/10 to-primary/5 p-3">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <ShieldCheck className="size-4 text-primary" /> Platform
            </div>
            <p className="mt-1 text-xs text-muted-foreground">TokoΦ · control plane</p>
          </div>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur-md sm:px-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Platform</span>
            <span className="text-muted-foreground/60">/</span>
            <span className="font-semibold text-foreground">{title}</span>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <Badge variant="secondary" className="hidden border-transparent bg-primary/12 text-primary sm:inline-flex">
              <ShieldCheck className="size-3" /> Platform
            </Badge>
            <Avatar className="size-8">
              <AvatarFallback className="bg-primary/15 text-xs font-semibold text-primary">SA</AvatarFallback>
            </Avatar>
          </div>
        </header>

        <main className="flex-1 bg-muted/30 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
