"use client";
import { useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Menu, Bell, Sun, Moon, ChevronDown, Check, ExternalLink, LogOut, User, CreditCard, ShieldCheck, Wallet } from "lucide-react";
import type { SearchItem } from "@/lib/data/search";
import type { TopbarData } from "@/lib/data/topbar";
import { IDR } from "@tokophi/lib/format";
import { Button } from "@tokophi/ui/button";
import { CommandPalette } from "./command-palette";
import { Avatar, AvatarFallback } from "@tokophi/ui/avatar";
import { Badge } from "@tokophi/ui/badge";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@tokophi/ui/sheet";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@tokophi/ui/dropdown-menu";
import { NavLinks, type NavCounts } from "./nav-links";
import { Brand } from "./brand";
import { signOut } from "@/lib/actions/auth";
import { switchStore } from "@/lib/actions/store";
import { ROLE_LABEL, type Role } from "@/lib/rbac-policy";

/**
 * The <html class="dark"> flag IS the state — the inline script in the root layout sets it before
 * paint. Mirroring it into React state via useEffect (what this used to do) meant a setState on
 * every mount, which the react-hooks lint rightly flags as a cascading render. Subscribe to the DOM
 * instead: no duplicate source of truth, and the SSR snapshot is `false` so hydration stays quiet.
 */
/**
 * 40px touch target on a 32px control: extend the HIT AREA, not the box (F-F11 / NF-7).
 * Width is the scarce resource this bar fights for — at 320px every visible pixel counts, so the
 * controls keep their 32px boxes and the ::after overlay carries the tap zone to 40×40. A wider
 * BOX here is the 320px overflow coming straight back.
 */
const HIT = "relative after:absolute after:-inset-1";

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
    <Button variant="ghost" size="icon" onClick={toggle} aria-label="Ganti tema" className={HIT}>
      {dark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
    </Button>
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
    // Was `hidden … sm:flex` — so below 640px a seller could not see their own money at all, on the
    // device they actually run the shop from. Shows at every width now. The topbar cannot fit both this
    // and the store name on a 360px phone, so the NAME gives way (see the store switcher): a seller
    // knows which shop is theirs, and the name is still one tap away in this bar's dropdown and in the
    // sidebar — the balance was nowhere.
    <Button
      variant="ghost"
      nativeButton={false}
      render={<Link href="/saldo" />}
      className={`${HIT} flex shrink-0 gap-1.5 px-2 font-medium tabular-nums sm:gap-2`}
      aria-label={`Saldo tersedia ${IDR(balance.available)} — buka rincian saldo`}
    >
      <Wallet className="size-[18px] text-muted-foreground" />
      {/* Below 360px the AMOUNT gives way, never the access: a real balance ("Rp214 jt", seeded
          batiknusantara) is ~70px this bar does not have at 320px — it was the single overflow the
          responsive audit flagged on all 24 seller routes. The chip stays (wallet icon → /saldo)
          and the aria-label always carries the full amount, so nothing is hidden from a screen
          reader or out of reach — the number itself is one tap away. NEVER truncate money instead:
          a clipped "Rp214…" reads as a different balance. */}
      <span className="text-sm max-[359px]:hidden">{IDR(balance.available, { compact: true })}</span>
    </Button>
  );
}

export function Topbar({
  user,
  storeName,
  storefrontHost,
  searchIndex = [],
  balance,
  notifs = [],
  navCounts,
  stores = [],
  currentStoreId,
}: {
  user?: { name: string; email: string; role?: string };
  storeName?: string;
  /** `<slug>.tokophi.id` — the store's public storefront origin (from the layout). */
  storefrontHost?: string;
  searchIndex?: SearchItem[];
  balance?: TopbarData["balance"];
  notifs?: TopbarData["notifs"];
  /** Live nav badge counts — this is a client component, so the layout fetches and hands them in. */
  navCounts?: NavCounts;
  /** EVERY live membership of the signed-in user, in contract order (Task 5.9 — `listMemberships`). */
  stores?: { id: string; name: string }[];
  /** The session's store — which row of `stores` is the active one. */
  currentStoreId?: string;
}) {
  const [mobileMenu, setMobileMenu] = useState(false);
  const router = useRouter();
  const [, startSwitch] = useTransition();
  // The switcher's rows are the layout's `listMemberships` read — the SESSION user's live
  // memberships, so an impersonated session shows exactly the one granted store. The mock STORES
  // list this used to fall back to offered shops the user had no membership in at all.
  const storeList = stores.length > 0 ? stores : storeName ? [{ id: currentStoreId ?? "current", name: storeName }] : [];
  const store = storeList.find((s) => s.id === currentStoreId) ?? storeList[0] ?? { id: "current", name: "Toko" };
  // Picking another store calls the `switchStore` server action, which proves membership in the
  // target against `store_users` and RE-MINTS the session cookie — the client never carries tenant
  // context itself. Land on the new store's dashboard: the current URL may name an entity of the
  // OLD store, which would 404 under the new tenant.
  const pickStore = (s: { id: string; name: string }) => {
    if (s.id === store.id) return;
    startSwitch(async () => {
      const r = await switchStore(s.id);
      if (r.ok) {
        router.push(r.slug ? `/store/${r.slug}` : "/");
        router.refresh();
      } else {
        toast.error(r.error);
      }
    });
  };
  const name = user?.name || "Ongki Pratama";
  const email = user?.email || "owner@tokophi.id";
  const roleLabel = user?.role ? ROLE_LABEL[user.role as Role] ?? user.role : null;
  const initials = name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "OP";
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur-md sm:px-6">
      {/* mobile menu — CONTROLLED so a nav tap closes the drawer. It was uncontrolled, so tapping a
          link navigated the page UNDERNEATH but left the drawer covering it: "diklik tidak tampil
          halaman". onNavigate (fired on every nav Link, not the expand chevron) now closes it. */}
      <Sheet open={mobileMenu} onOpenChange={setMobileMenu}>
        <SheetTrigger
          render={
            <Button variant="ghost" size="icon" className={`${HIT} lg:hidden`} aria-label="Menu">
              <Menu className="size-5" />
            </Button>
          }
        />
        <SheetContent side="left" className="flex w-72 flex-col p-0">
          <SheetTitle className="sr-only">Menu navigasi</SheetTitle>
          <div className="flex h-16 shrink-0 items-center border-b px-5"><Brand /></div>
          <div className="flex-1 overflow-y-auto py-4">
            <NavLinks counts={navCounts} onNavigate={() => setMobileMenu(false)} />
          </div>
        </SheetContent>
      </Sheet>

      {/* store switcher */}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" className={`${HIT} min-w-0 shrink gap-2 font-medium`}>
              <span className="flex size-5 shrink-0 items-center justify-center rounded bg-primary/15 text-[10px] font-bold text-primary">
                {store.name.slice(0, 2).toUpperCase()}
              </span>
              {/* The name is the only thing in this row big enough to give up. It is `hidden` below
                  `sm` because the balance chip now shows there instead (SaldoChip above) and the two
                  cannot both fit a 360px phone: px-4 + Menu + switcher + Saldo + the right cluster.
                  Money beats a name the seller already knows — and the name is still right here in this
                  dropdown, and in the sidebar. The 2-letter badge keeps the store identifiable.
                  `min-w-0` lets it truncate before it pushes, instead of pushing. */}
              <span className="hidden max-w-[140px] truncate sm:inline">{store.name}</span>
              {/* The chevron is decoration on a 320px phone — the 2-letter badge is already an
                  obviously-tappable button, and those 24px (icon + gap) are part of what pushed the
                  bar past the viewport. It returns at 360px with the room. */}
              <ChevronDown className="size-4 shrink-0 text-muted-foreground max-[359px]:hidden" />
            </Button>
          }
        />
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuLabel>Toko aktif</DropdownMenuLabel>
          {storeList.map((s) => (
            <DropdownMenuItem key={s.id} onClick={() => pickStore(s)} className="gap-2">
              <span className="flex size-6 items-center justify-center rounded bg-muted text-[10px] font-bold">
                {s.name.slice(0, 2).toUpperCase()}
              </span>
              <span className="flex-1">{s.name}</span>
              {s.id === store.id && <Check className="size-4 text-primary" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          {storefrontHost ? (
            <DropdownMenuItem
              className="gap-2 text-muted-foreground"
              render={<a href={`https://${storefrontHost}`} target="_blank" rel="noopener noreferrer" />}
            >
              <ExternalLink className="size-4" /> Kunjungi storefront
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem disabled className="gap-2 text-muted-foreground opacity-60"><ExternalLink className="size-4" /> Kunjungi storefront</DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* site-wide ⌘K command palette — pages + pesanan/produk/pelanggan; works on mobile too. */}
      <CommandPalette index={searchIndex} />

      <div className="ml-auto flex items-center gap-1">
        {balance && <SaldoChip balance={balance} />}
        <div className="mx-1 hidden h-6 w-px bg-border sm:block" />
        <ThemeToggle />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className={HIT}
                // ⚠️ The dot below was the ONLY signal that anything is waiting — a bare coloured
                // circle with no text, and the label said "Notifikasi" either way, so nothing about
                // "there is something new" reached a screen reader or anyone who cannot see the
                // colour. `obrolan-client.tsx` already does it right; this is the same fix.
                aria-label={notifs.length > 0 ? `Notifikasi — ${notifs.length} baru` : "Notifikasi"}
              >
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
              <Button variant="ghost" className={`${HIT} gap-2 pl-1.5 pr-2`}>
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
