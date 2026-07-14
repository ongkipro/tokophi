"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { NAV_GROUPS, type NavItem } from "@/lib/nav";
import { cn } from "@tokophi/ui/lib/utils";
import { Badge } from "@tokophi/ui/badge";
import { useStoreHref } from "@/components/admin/store-context";


/**
 * Child links may differ ONLY by query string — /pesanan, /pesanan?tab=perlu_dikirim,
 * /pesanan?tab=pengembalian are three saved views onto one route. Comparing `pathname` alone (which
 * is what this did) makes the first child win on every one of them: click "Perlu Dikirim" and
 * "Pesanan Saya" stays lit. The nav then lies about where you are, which is worse than no highlight
 * at all — you stop trusting it.
 *
 * So compare the path AND the params the link actually carries. A link with no params is active only
 * when the URL carries none of the params its siblings use — otherwise "Pesanan Saya" would also
 * light up while you are looking at ?tab=pengembalian.
 */
function isChildActive(pathname: string, search: URLSearchParams, href: string): boolean {
  const [path, query = ""] = href.split("?");
  if (pathname !== path && !pathname.startsWith(path + "/")) return false;

  const want = new URLSearchParams(query);
  if ([...want.keys()].length === 0) {
    // the "plain" sibling: active only when no sibling's discriminating param is present
    return !search.get("tab");
  }
  for (const [k, v] of want) {
    if (search.get(k) !== v) return false;
  }
  return true;
}

function isSectionActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

// strip the Shopify-style /store/{slug} prefix so active-state compares against the internal route
function stripStore(pathname: string): string {
  return pathname.replace(/^\/store\/[^/]+/, "") || "/";
}

function Item({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const storeHref = useStoreHref();
  const pathname = stripStore(usePathname());
  const search = useSearchParams();
  const active = isSectionActive(pathname, item.href);
  const [open, setOpen] = React.useState<boolean | null>(null);
  const expanded = item.children ? (open ?? active) : false;

  const rowLink = (
    <Link
      href={storeHref(item.href)}
      onClick={onNavigate}
      className={cn(
        "group flex flex-1 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <item.icon className={cn("size-[18px] shrink-0", active ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
      <span className="flex-1">{item.label}</span>
      {item.badge && <Badge variant={active ? "default" : "secondary"} className="h-5 px-1.5 text-[11px]">{item.badge}</Badge>}
    </Link>
  );

  if (!item.children) return rowLink;

  return (
    <div>
      <div className="flex items-center">
        {rowLink}
        <button
          type="button"
          onClick={() => setOpen(!expanded)}
          aria-label={expanded ? `Tutup ${item.label}` : `Buka ${item.label}`}
          aria-expanded={expanded}
          className="ml-0.5 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronRight className={cn("size-4 transition-transform", expanded && "rotate-90")} />
        </button>
      </div>
      {expanded && (
        <div className="mt-0.5 ml-[26px] flex flex-col gap-0.5 border-l pl-3">
          {item.children.map((c) => {
            const cActive = isChildActive(pathname, search, c.href);
            return (
              <Link
                key={c.href}
                href={storeHref(c.href)}
                onClick={onNavigate}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm transition-colors",
                  cActive ? "font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {c.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-4 px-3">
      {NAV_GROUPS.map((group, gi) => (
        <div key={gi} className="flex flex-col gap-1">
          {group.label && (
            <p className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{group.label}</p>
          )}
          {group.items.map((item) => (
            <Item key={item.href} item={item} onNavigate={onNavigate} />
          ))}
        </div>
      ))}
    </nav>
  );
}
