import { NavLinks } from "./nav-links";
import { Brand } from "./brand";
import { Sparkles } from "lucide-react";

export function Sidebar() {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r bg-card lg:flex">
      <div className="flex h-16 items-center border-b px-5">
        <Brand />
      </div>
      <div className="flex-1 overflow-y-auto py-4">
        <NavLinks />
      </div>
      <div className="p-3">
        <div className="rounded-xl border bg-gradient-to-br from-primary/10 to-primary/5 p-4">
          <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="size-4 text-primary" /> Paket Bisnis
          </div>
          <p className="text-xs text-muted-foreground">Fitur analitik & multi-toko aktif. 21 hari tersisa di trial.</p>
        </div>
      </div>
    </aside>
  );
}
