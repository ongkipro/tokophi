"use client";
import { useEffect, useState } from "react";
import { Menu, Search, Bell, Sun, Moon, ChevronDown, Check, ExternalLink, LogOut, User, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NavLinks } from "./nav-links";
import { Brand } from "./brand";
import { signOut } from "@/lib/actions/auth";
import { STORES } from "@/lib/nav";
import { ROLE_LABEL, type Role } from "@/lib/rbac-policy";

function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem("theme", next ? "dark" : "light"); } catch {}
  };
  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label="Ganti tema">
      {dark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
    </Button>
  );
}

export function Topbar({ user, storeName }: { user?: { name: string; email: string; role?: string }; storeName?: string }) {
  // Current store reflects the session (so an impersonated store shows its own name, not a hardcode).
  const [store, setStore] = useState(storeName ? { id: "current", name: storeName, plan: STORES[0]?.plan ?? "Bisnis" } : STORES[0]);
  const name = user?.name || "Ongki Pratama";
  const email = user?.email || "owner@tokophi.id";
  const roleLabel = user?.role ? ROLE_LABEL[user.role as Role] ?? user.role : null;
  const initials = name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "OP";
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur-md sm:px-6">
      {/* mobile menu */}
      <Sheet>
        <SheetTrigger
          render={
            <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Menu">
              <Menu className="size-5" />
            </Button>
          }
        />
        <SheetContent side="left" className="w-72 p-0">
          <SheetTitle className="sr-only">Menu navigasi</SheetTitle>
          <div className="flex h-16 items-center border-b px-5"><Brand /></div>
          <div className="py-4"><NavLinks /></div>
        </SheetContent>
      </Sheet>

      {/* store switcher */}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" className="gap-2 font-medium">
              <span className="flex size-5 items-center justify-center rounded bg-primary/15 text-[10px] font-bold text-primary">
                {store.name.slice(0, 2).toUpperCase()}
              </span>
              <span className="max-w-[140px] truncate">{store.name}</span>
              <ChevronDown className="size-4 text-muted-foreground" />
            </Button>
          }
        />
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuLabel>Pilih Toko</DropdownMenuLabel>
          {STORES.map((s) => (
            <DropdownMenuItem key={s.id} onClick={() => setStore(s)} className="gap-2">
              <span className="flex size-6 items-center justify-center rounded bg-muted text-[10px] font-bold">
                {s.name.slice(0, 2).toUpperCase()}
              </span>
              <span className="flex-1">{s.name}</span>
              {s.id === store.id ? <Check className="size-4 text-primary" /> : <Badge variant="secondary" className="text-[10px]">{s.plan}</Badge>}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="gap-2 text-muted-foreground"><ExternalLink className="size-4" /> Kunjungi storefront</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* search */}
      <div className="relative ml-1 hidden max-w-sm flex-1 md:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Cari pesanan, produk, pelanggan…  ⌘K" className="pl-9" />
      </div>

      <div className="ml-auto flex items-center gap-1">
        <ThemeToggle />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon" className="relative" aria-label="Notifikasi">
                <Bell className="size-[18px]" />
                <span className="absolute right-2 top-2 size-2 rounded-full bg-primary ring-2 ring-background" />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuLabel>Notifikasi</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="flex-col items-start gap-0.5">
              <span className="text-sm font-medium">3 pesanan baru menunggu</span>
              <span className="text-xs text-muted-foreground">Perlu diproses hari ini</span>
            </DropdownMenuItem>
            <DropdownMenuItem className="flex-col items-start gap-0.5">
              <span className="text-sm font-medium">Stok "Earphone TWS" menipis</span>
              <span className="text-xs text-muted-foreground">Sisa 4 unit</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" className="gap-2 pl-1.5 pr-2">
                <Avatar className="size-7"><AvatarFallback className="bg-primary/15 text-xs font-semibold text-primary">{initials}</AvatarFallback></Avatar>
                <span className="hidden text-sm font-medium sm:inline">{name.split(" ")[0]}</span>
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel className="font-normal">
              <div className="flex items-center gap-2">
                <div className="text-sm font-medium">{name}</div>
                {roleLabel && <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{roleLabel}</Badge>}
              </div>
              <div className="text-xs text-muted-foreground">{email}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2"><User className="size-4" /> Profil</DropdownMenuItem>
            <DropdownMenuItem className="gap-2"><CreditCard className="size-4" /> Langganan</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2 text-destructive" onClick={() => signOut()}><LogOut className="size-4" /> Keluar</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
