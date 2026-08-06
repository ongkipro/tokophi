import { ArrowRight, LogIn, Menu, X } from "lucide-react";

import { Button } from "@tokophi/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@tokophi/ui/sheet";

import type { MarketingRoute } from "../lib/navigation";
import { isCurrentRoute } from "../lib/navigation";

interface Props {
  routes: readonly MarketingRoute[];
  currentPath: string;
  loginUrl: string;
  signupUrl: string;
}

export function MobileNav({ routes, currentPath, loginUrl, signupUrl }: Props) {
  return (
    <div className="mobile-nav-island">
      <Sheet>
        <SheetTrigger
          render={
            <Button
              variant="outline"
              size="icon-lg"
              aria-label="Buka menu utama"
              className="border-line bg-surface text-ink hover:bg-primary-soft"
            />
          }
        >
          <Menu aria-hidden="true" />
        </SheetTrigger>

        <SheetContent
          side="right"
          showCloseButton={false}
          className="w-[min(88vw,24rem)] border-line bg-surface text-ink [--color-muted:var(--color-primary-soft)]"
        >
          <SheetHeader className="border-b border-line px-5 py-5">
            <SheetTitle className="font-semibold text-ink">Menu utama</SheetTitle>
            <SheetDescription className="text-ink-muted">
              Pelajari Tokophi atau lanjut ke Dashboard Seller.
            </SheetDescription>
            <SheetClose
              render={
                <Button
                  variant="ghost"
                  size="icon-lg"
                  aria-label="Tutup menu utama"
                  className="absolute top-4 right-4 text-ink hover:bg-primary-soft"
                />
              }
            >
              <X aria-hidden="true" />
            </SheetClose>
          </SheetHeader>

          <nav className="flex flex-1 flex-col px-3 py-4" aria-label="Navigasi mobile">
            <ul className="space-y-1">
              {routes.map((route) => {
                const current = isCurrentRoute(currentPath, route.href);
                return (
                  <li key={route.href}>
                    <a
                      href={route.href}
                      aria-current={current ? "page" : undefined}
                      className="flex min-h-12 items-center justify-between rounded-lg px-3 text-[0.9375rem] font-medium text-ink transition-colors hover:bg-primary-soft aria-[current=page]:bg-primary-soft aria-[current=page]:text-primary-ink"
                    >
                      {route.label}
                      <ArrowRight aria-hidden="true" className="size-4" />
                    </a>
                  </li>
                );
              })}
            </ul>

            <div className="mt-auto grid gap-2 border-t border-line pt-4">
              <Button
                variant="outline"
                size="lg"
                render={<a href={loginUrl} className="h-11 border-line bg-surface text-ink" />}
              >
                <LogIn aria-hidden="true" />
                Masuk
              </Button>
              <Button
                size="lg"
                render={<a href={signupUrl} className="h-11 bg-primary text-primary-foreground" />}
              >
                Buat toko
                <ArrowRight aria-hidden="true" />
              </Button>
            </div>
          </nav>
        </SheetContent>
      </Sheet>
    </div>
  );
}
