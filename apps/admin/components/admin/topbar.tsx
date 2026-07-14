"use client";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Menu, Search, Bell, Sun, Moon, ChevronDown, Check, ExternalLink, LogOut, User, CreditCard, ShieldCheck, Wallet } from "lucide-react";
import type { SearchItem } from "@/lib/data/search";
import type { TopbarData } from "@/lib/data/topbar";
import { IDR } from "@tokophi/lib/format";
import { Button } from "@tokophi/ui/button";
import { Input } from "@tokophi/ui/input";
import { Avatar, AvatarFallback } from "@tokophi/ui/avatar";
import { Badge } from "@tokophi/ui/badge";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@tokophi/ui/sheet";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@tokophi/ui/dropdown-menu";
import { NavLinks } from "./nav-links";
import { Brand } from "./brand";
import { signOut } from "@/lib/actions/auth";
import { STORES } from "@/lib/nav";
import { ROLE_LABEL, type Role } from "@/lib/rbac-policy";

/**
 * The <html class="dark"> flag IS the state — the inline script in the root layout sets it before
 * paint. Mirroring it into React state via useEffect (what this used to do) meant a setState on
 * every mount, which the react-hooks lint rightly flags as a cascading render. Subscribe to the DOM
 * instead: no duplicate source of truth, and the SSR snapshot is `false` so hydration stays quiet.
 */
function useIsDark() {
  return useSyncExternalStore(
    (onChange) => {
      const mo = new MutationObserver(onChange);
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
      return () => mo.disconnect();
    },
    () => document.documentElement.classList.contains("dark"),
    () => false,
  );
}

function ThemeToggle() {
  const dark = useIsDark();
  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem("theme", next ? "dark" : "light"); } catch {}
  };
  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label="Ganti tema">
      {dark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
    </Button>
  );
}

const TYPE_LABEL: Record<SearchItem["type"], string> = { produk: "Produk", pesanan: "Pesanan", pelanggan: "Pelanggan" };

function GlobalSearch({ index }: { index: SearchItem[] }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [] as SearchItem[];
    return index.filter((i) => i.label.toLowerCase().includes(s) || i.sub.toLowerCase().includes(s)).slice(0, 8);
  }, [q, index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); inputRef.current?.focus(); setOpen(true); }
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onClick); };
  }, []);

  return (
    <div ref={boxRef} className="relative ml-1 hidden max-w-sm flex-1 md:block">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Cari pesanan, produk, pelanggan…  ⌘K"
        className="pl-9"
      />
      {open && q.trim() && (
        <div className="absolute inset-x-0 top-full z-50 mt-2 overflow-hidden rounded-lg border bg-popover shadow-lg">
          {results.length ? (
            <ul className="max-h-80 overflow-y-auto py-1">
              {results.map((r) => (
                <li key={r.type + r.id}>
                  <Link
                    href={r.href}
                    onClick={() => { setOpen(false); setQ(""); }}
                    className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-muted"
                  >
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{TYPE_LABEL[r.type]}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{r.label}</span>
                      {r.sub && <span className="block truncate text-xs text-muted-foreground">{r.sub}</span>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-4 text-sm text-muted-foreground">Tidak ada hasil untuk “{q}”.</p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Saldo — the merchant's money, read from the ledger (migration 0040).
 *
 * This chip IS the entry point to Saldo: there is deliberately no sidebar row for it. Shopify's
 * restraint — the nav is for the WORK, and money is not somewhere you navigate to, it is something
 * you glance at. So it sits in the header, always visible next to the avatar (the way every
 * Indonesian seller tool does it), and clicking through opens the full page.
 *
 * The two numbers must never be collapsed into one. "Tersedia" is money the merchant can take
 * today; "Dalam proses" is money the platform is holding against orders that have not finished —
 * and a parcel that comes back takes its credit with it. Showing only the total would promise cash
 * that cannot be withdrawn, which is precisely the number that gets a platform shouted at.
 */
function SaldoChip({ balance }: { balance: TopbarData["balance"] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" className="hidden gap-2 px-2 font-medium tabular-nums sm:flex" aria-label="Saldo">
            <Wallet className="size-[18px] text-muted-foreground" />
            <span className="text-sm">{IDR(balance.available, { compact: true })}</span>
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Saldo</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="space-y-2.5 px-2 py-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs text-muted-foreground">Tersedia</span>
            <span className="text-sm font-semibold tabular-nums">{IDR(balance.available)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs text-muted-foreground">Dalam proses</span>
            <span className="text-sm tabular-nums text-muted-foreground">{IDR(balance.pending)}</span>
          </div>
          {balance.returned > 0 && (
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs text-muted-foreground">Ditarik kembali (retur)</span>
              <span className="text-sm tabular-nums text-muted-foreground">{IDR(balance.returned)}</span>
            </div>
          )}
          <p className="border-t pt-2 text-xs leading-relaxed text-muted-foreground">
            Dana masuk saat pesanan <span className="font-medium text-foreground">selesai</span>.
          </p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="gap-2 font-medium" render={<Link href="/saldo" />}>
          <Wallet className="size-4" /> Lihat detail &amp; tarik saldo
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Topbar({
  user,
  storeName,
  searchIndex = [],
  balance,
  notifs = [],
}: {
  user?: { name: string; email: string; role?: string };
  storeName?: string;
  searchIndex?: SearchItem[];
  balance?: TopbarData["balance"];
  notifs?: TopbarData["notifs"];
}) {
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
          <DropdownMenuLabel>Toko aktif</DropdownMenuLabel>
          {[store].map((s) => (
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

      {/* site-wide search. NB: never begin a comment here with the word "global" — ESLint reads
          that as its global-variable declaration directive and warns about an unused global. */}
      <GlobalSearch index={searchIndex} />

      <div className="ml-auto flex items-center gap-1">
        {balance && <SaldoChip balance={balance} />}
        <div className="mx-1 hidden h-6 w-px bg-border sm:block" />
        <ThemeToggle />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon" className="relative" aria-label="Notifikasi">
                <Bell className="size-[18px]" />
                {/* dot only when there is actually something to see */}
                {notifs.length > 0 && (
                  <span className="absolute right-2 top-2 size-2 rounded-full bg-primary ring-2 ring-background" />
                )}
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuLabel>Notifikasi</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {notifs.length === 0 ? (
              <p className="px-2 py-4 text-center text-sm text-muted-foreground">
                Tidak ada yang perlu ditindak.
              </p>
            ) : (
              notifs.map((n) => (
                <DropdownMenuItem key={n.id} className="flex-col items-start gap-0.5" render={<Link href={n.href} />}>
                  <span className="text-sm font-medium">{n.title}</span>
                  <span className="text-xs text-muted-foreground">{n.sub}</span>
                </DropdownMenuItem>
              ))
            )}
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
            <DropdownMenuItem className="gap-2" render={<Link href="/akun/profil" />}><User className="size-4" /> Profil</DropdownMenuItem>
            <DropdownMenuItem className="gap-2" render={<Link href="/akun/keamanan" />}><ShieldCheck className="size-4" /> Keamanan</DropdownMenuItem>
            <DropdownMenuItem className="gap-2" render={<Link href="/akun/langganan" />}><CreditCard className="size-4" /> Langganan</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2 text-destructive" onClick={() => signOut()}><LogOut className="size-4" /> Keluar</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
