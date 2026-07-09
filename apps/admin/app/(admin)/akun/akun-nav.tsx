"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserRound, ShieldCheck, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/akun/profil", label: "Profil", icon: UserRound },
  { href: "/akun/keamanan", label: "Keamanan", icon: ShieldCheck },
  { href: "/akun/langganan", label: "Langganan", icon: Sparkles },
];

export function AkunNav() {
  const pathname = usePathname();
  return (
    <div className="flex flex-wrap gap-1 rounded-xl border bg-muted/40 p-1">
      {TABS.map((t) => {
        const active = pathname === t.href || pathname.startsWith(t.href + "/");
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors sm:flex-none",
              active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <t.icon className="size-4" />
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
