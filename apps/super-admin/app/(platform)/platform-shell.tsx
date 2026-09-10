"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShieldCheck, LogOut, KeyRound, Menu, Sun, Moon } from "lucide-react";
import { BrandWordmark } from "@tokophi/ui/brand-wordmark";
import { toast } from "sonner";
import { cn } from "@tokophi/ui/lib/utils";
import { Avatar, AvatarFallback } from "@tokophi/ui/avatar";
import { Badge } from "@tokophi/ui/badge";
import { Button } from "@tokophi/ui/button";
import { Input } from "@tokophi/ui/input";
import { Label } from "@tokophi/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@tokophi/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuSeparator,
} from "@tokophi/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@tokophi/ui/sheet";
import { NAV, NAV_GROUPS, navFor, type NavItem } from "@/lib/nav";
import { signOut, changePlatformPassword } from "@/lib/actions/auth";

type Admin = { name: string; email: string; role: string };

/** The rank as the operator reads it. `platform-rank.ts` owns the ladder; this is only its label. */
const RANK_LABEL: Record<string, string> = { support: "Support", admin: "Admin", owner: "Owner" };

/** 40px touch target on a 32px control: extend the HIT AREA, not the box (same rule as the Seller topbar). */
const HIT = "relative after:absolute after:-inset-1";

/**
 * `<html class="dark">` IS the state — the inline script in the root layout sets it before paint.
 * Subscribe to the DOM rather than mirror it into React state (a setState on mount is a cascading
 * render the hooks lint flags); the SSR snapshot is `false` so hydration stays quiet.
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
    <Button variant="ghost" size="icon" onClick={toggle} aria-label="Ganti tema" className={HIT}>
      {dark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
    </Button>
  );
}

/**
 * ONE nav list, rendered twice: in the sidebar (≥ md) and inside the mobile drawer. Grouped by the
 * kind of work (`lib/nav.ts`); a group the operator's rank cannot open at all is not shown.
 * `onNavigate` lets the drawer close itself on a tap — an uncontrolled drawer navigates the page
 * UNDERNEATH and stays open over it (the Seller topbar paid for that lesson).
 */
function NavLinks({ items, isActive, openTickets, onNavigate }: { items: NavItem[]; isActive: (href: string) => boolean; openTickets: number; onNavigate?: () => void }) {
  const link = (item: NavItem) => {
    const active = isActive(item.href);
    const Icon = item.icon;
    // Real count of support_tickets with status = 'open'.
    const badge = item.href === "/tiket" && openTickets > 0 ? openTickets : 0;
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
          active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <Icon className="size-4 shrink-0" />
        <span className="flex-1">{item.label}</span>
        {badge > 0 && (
          <span className="flex min-w-5 items-center justify-center rounded-full bg-amber-500/15 px-1.5 text-[11px] font-semibold tabular-nums text-amber-600 dark:text-amber-400">
            {badge}
          </span>
        )}
      </Link>
    );
  };
  const home = items.filter((i) => !i.group);
  return (
    <nav aria-label="Navigasi platform" className="space-y-5">
      {home.length > 0 && <div className="space-y-1">{home.map(link)}</div>}
      {NAV_GROUPS.map((g) => {
        const rows = items.filter((i) => i.group === g);
        if (!rows.length) return null;
        return (
          <div key={g} className="space-y-1">
            {/* A group label in the eyebrow voice the front door uses — hierarchy by type, not by a card. */}
            <p className="px-3 pb-1 font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/70">{g}</p>
            {rows.map(link)}
          </div>
        );
      })}
    </nav>
  );
}

export function PlatformShell({ admin, openTickets, children }: { admin: Admin; openTickets: number; children: React.ReactNode }) {
  const pathname = usePathname();

  // Only the destinations this operator's rank can open. UX, not the boundary — see `navFor`. The
  // TITLE is still resolved against the full NAV: a denied page must still be named in the header,
  // or the refusal screen appears under the previous page's title.
  const nav = navFor(admin.role);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/") || pathname.startsWith(href);

  const current = NAV.find((n) => isActive(n.href));
  const title = current?.label ?? "Platform";
  const inits = (admin.name || admin.email).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "SA";

  // "Ubah kata sandi" — the operator's own credential, so it sits in the account menu next to
  // "Keluar" rather than in Pengaturan → Tim Platform (which is the roster of OTHER operators).
  const [mobileMenu, setMobileMenu] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNext, setPwNext] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwSaving, startPwSave] = useTransition();

  function submitPassword() {
    // Confirmation is checked here and NOT in the action: it is a typo guard on this form, not a
    // rule about the credential. The action's rules (session, length, current password, and "must
    // actually differ") are the boundary and are enforced there.
    if (pwNext !== pwConfirm) {
      toast.error("Konfirmasi kata sandi tidak cocok.");
      return;
    }
    startPwSave(async () => {
      const r = await changePlatformPassword(pwCurrent, pwNext);
      if (!r.ok) {
        toast.error(r.error ?? "Gagal mengubah kata sandi.");
        return;
      }
      setPwOpen(false);
      setPwCurrent("");
      setPwNext("");
      setPwConfirm("");
      toast.success("Kata sandi diubah. Sesi lain yang memakai kata sandi lama sudah dicabut.");
    });
  }

  return (
    <div className="flex min-h-screen w-full">
      {/* Sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-card md:flex">
        <div className="flex h-14 items-center gap-2.5 border-b px-4">
          {/* Ubin + ikon `Store` dibuang — lihat `@tokophi/ui/brand-wordmark`. Φ-nya sudah tanda
              merknya; ikon generik di sebelahnya cuma memperebutkan perhatian dengan nama produk. */}
          <div className="min-w-0">
            <BrandWordmark className="block truncate text-sm" />
            <div className="mt-1 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
              <ShieldCheck className="size-3 text-primary" /> Super Admin
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          <NavLinks items={nav} isActive={isActive} openTickets={openTickets} />
        </div>
        {/* The gradient "Platform · control plane" card that used to sit here said nothing the
            header does not already say, twice. Decoration in the one column that is always on screen
            competes with the nav for the eye; the rank the operator holds is the fact worth a glance,
            and it lives beside their avatar now. */}
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur-md sm:px-6">
          {/* Mobile drawer — the sidebar is `hidden md:flex`, and until 2026-09-11 nothing replaced it
              below `md`: an operator on a phone had a header, a page, and no way to reach any other
              page. CONTROLLED so a nav tap closes it (see `NavLinks`). */}
          <Sheet open={mobileMenu} onOpenChange={setMobileMenu}>
            <SheetTrigger
              render={
                <Button variant="ghost" size="icon" className={`${HIT} md:hidden`} aria-label="Menu">
                  <Menu className="size-5" />
                </Button>
              }
            />
            <SheetContent side="left" className="flex w-72 flex-col p-0">
              <SheetTitle className="sr-only">Menu navigasi</SheetTitle>
              <div className="flex h-14 shrink-0 items-center gap-2.5 border-b px-4">
                <div className="min-w-0">
                  <BrandWordmark className="block truncate text-sm" />
                  <div className="mt-1 flex items-center gap-1 text-[11px] font-medium text-muted-foreground"><ShieldCheck className="size-3 text-primary" /> Super Admin</div>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-3">
                <NavLinks items={nav} isActive={isActive} openTickets={openTickets} onNavigate={() => setMobileMenu(false)} />
              </div>
            </SheetContent>
          </Sheet>
          <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
            <span className="hidden font-medium text-foreground sm:inline">Platform</span>
            <span className="hidden text-muted-foreground/60 sm:inline">/</span>
            <span className="truncate font-semibold text-foreground">{title}</span>
          </div>

          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <ThemeToggle />
            {/* The operator's RANK — information, where a decorative "Platform" badge used to be. It is
                what decides which of these screens refuse (`route-roles.ts`), so it earns a glance. */}
            <Badge variant="secondary" className="hidden border-transparent bg-primary/12 text-primary sm:inline-flex" title="Peran operator">
              <ShieldCheck className="size-3" /> {RANK_LABEL[admin.role] ?? admin.role}
            </Badge>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button className="rounded-full outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring" aria-label="Akun">
                    <Avatar className="size-8">
                      <AvatarFallback className="bg-primary/15 text-xs font-semibold text-primary">{inits}</AvatarFallback>
                    </Avatar>
                  </button>
                }
              />
              <DropdownMenuContent align="end" className="w-56">
                <div className="px-2 py-1.5">
                  <div className="truncate text-sm font-medium">{admin.name || "Platform Admin"}</div>
                  <div className="truncate text-xs text-muted-foreground">{admin.email}</div>
                </div>
                <DropdownMenuSeparator />
                <button
                  type="button"
                  onClick={() => setPwOpen(true)}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-muted"
                >
                  <KeyRound className="size-4" /> Ubah kata sandi
                </button>
                <form action={signOut}>
                  <button
                    type="submit"
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive transition-colors hover:bg-destructive/10"
                  >
                    <LogOut className="size-4" /> Keluar
                  </button>
                </form>
              </DropdownMenuContent>
            </DropdownMenu>

            <Dialog open={pwOpen} onOpenChange={setPwOpen}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Ubah kata sandi</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-4 py-2">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="pw-current">Kata sandi saat ini</Label>
                    <Input id="pw-current" name="current" type="password" autoComplete="current-password" value={pwCurrent} onChange={(e) => setPwCurrent(e.target.value)} />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="pw-next">Kata sandi baru</Label>
                    <Input id="pw-next" name="next" type="password" autoComplete="new-password" value={pwNext} onChange={(e) => setPwNext(e.target.value)} />
                    <p className="text-xs text-muted-foreground">Minimal 8 karakter.</p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="pw-confirm">Ulangi kata sandi baru</Label>
                    <Input id="pw-confirm" name="confirm" type="password" autoComplete="new-password" value={pwConfirm} onChange={(e) => setPwConfirm(e.target.value)} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Setelah diubah, semua sesi yang dibuka dengan kata sandi lama langsung berakhir — di perangkat mana pun. Tab ini tetap masuk.
                  </p>
                </div>
                <DialogFooter>
                  <DialogClose render={<Button variant="outline">Batal</Button>} />
                  <Button disabled={pwSaving || !pwCurrent || !pwNext} onClick={submitPassword}>
                    {pwSaving ? "Menyimpan…" : "Simpan"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </header>

        <main className="flex-1 bg-muted/30 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
