"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShieldCheck, LogOut, KeyRound } from "lucide-react";
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
import { NAV } from "@/lib/nav";
import { signOut, changePlatformPassword } from "@/lib/actions/auth";

type Admin = { name: string; email: string };

export function PlatformShell({ admin, openTickets, children }: { admin: Admin; openTickets: number; children: React.ReactNode }) {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/") || pathname.startsWith(href);

  const current = NAV.find((n) => isActive(n.href));
  const title = current?.label ?? "Platform";
  const inits = (admin.name || admin.email).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "SA";

  // "Ubah kata sandi" — the operator's own credential, so it sits in the account menu next to
  // "Keluar" rather than in Pengaturan → Tim Platform (which is the roster of OTHER operators).
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

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {NAV.map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;
            // Real count of support_tickets with status = 'open'.
            const badge = item.href === "/tiket" && openTickets > 0 ? openTickets : 0;
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
                <span className="flex-1">{item.label}</span>
                {badge > 0 && (
                  <span className="flex min-w-5 items-center justify-center rounded-full bg-amber-500/15 px-1.5 text-[11px] font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                    {badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

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
