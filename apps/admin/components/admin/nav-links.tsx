"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { NAV_GROUPS, type NavItem, type NavChild, type NavBadgeKey } from "@/lib/nav";
import { num } from "@tokophi/lib/format";
import { cn } from "@tokophi/ui/lib/utils";
import { Badge } from "@tokophi/ui/badge";
import { useStoreHref } from "@/components/admin/store-context";


/**
 * Exactly ONE child lights up — the MOST SPECIFIC match for the current URL. Two rules compose:
 *
 *  1. Path specificity. The child whose path is the longest prefix of `pathname` wins. Evaluating each
 *     child in isolation (the old `isChildActive`) is what lit two at once: on `/pesanan/massal` the
 *     index child `/pesanan` also passes `startsWith("/pesanan/")`, so "Pesanan Saya" AND "Pengiriman
 *     Massal" were both highlighted. A nav that says you are in two places is worse than no highlight —
 *     you stop trusting it. Same shape under Keuangan (`/keuangan` + `/keuangan/penghasilan`).
 *
 *  2. Query views. `/pesanan`, `/pesanan?tab=perlu_dikirim`, `/pesanan?tab=pengembalian` are saved views
 *     onto one route. A link's params must match the URL's, and the plain (no-param) sibling is NOT the
 *     answer when the URL carries a discriminating tab a sibling owns — else "Pesanan Saya" lights on
 *     `?tab=pengembalian`. A matching query breaks ties toward the more specific view of the same route.
 *
 * Returns the winning child's href (compare by identity), or null when none match.
 */
function activeChildHref(pathname: string, search: URLSearchParams, children: NavChild[]): string | null {
  let bestHref: string | null = null;
  let bestScore = -1;
  for (const child of children) {
    const [path, query = ""] = child.href.split("?");
    if (pathname !== path && !pathname.startsWith(path + "/")) continue;

    const want = new URLSearchParams(query);
    const wantKeys = [...want.keys()];
    let queryScore = 0;
    if (wantKeys.length === 0) {
      // the plain sibling: skip it only when a discriminating tab (a sibling's) is on this exact path
      if (search.get("tab") && pathname === path) continue;
    } else {
      let ok = true;
      for (const [k, v] of want) {
        if (search.get(k) !== v) { ok = false; break; }
      }
      if (!ok) continue;
      queryScore = wantKeys.length;
    }
    // longest path wins (×100 dominates); a matching query breaks ties on the same route
    const score = path.length * 100 + queryScore;
    if (score > bestScore) {
      bestScore = score;
      bestHref = child.href;
    }
  }
  return bestHref;
}

function isSectionActive(pathname: string, href: string) {
  // A section may carry a default tab (Pesanan → "/pesanan?tab=perlu_dikirim"). Compare the PATH only:
  // otherwise the parent never highlights and its submenu never auto-expands on "/pesanan/massal".
  const path = href.split("?")[0];
  if (path === "/") return pathname === "/";
  return pathname === path || pathname.startsWith(path + "/");
}

// strip the Shopify-style /store/{slug} prefix so active-state compares against the internal route
function stripStore(pathname: string): string {
  return pathname.replace(/^\/store\/[^/]+/, "") || "/";
}

function Item({ item, onNavigate, counts }: { item: NavItem; onNavigate?: () => void; counts?: NavCounts }) {
  const storeHref = useStoreHref();
  const pathname = stripStore(usePathname());
  const search = useSearchParams();
  const active = isSectionActive(pathname, item.href);
  const [open, setOpen] = React.useState<boolean | null>(null);
  const expanded = item.children ? (open ?? active) : false;
  const badgeCount = item.badgeKey ? (counts?.[item.badgeKey] ?? 0) : 0;

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
      {/* Real count, server-fetched (was the literal string "7"). Hidden at zero: a badge means
          "there is work here" — a grey 0 is noise that trains the eye to skip the row. */}
      {badgeCount ? (
        <Badge variant={active ? "default" : "secondary"} className="h-5 px-1.5 text-[11px] tabular-nums">
          {num(badgeCount)}
        </Badge>
      ) : null}
    </Link>
  );

  if (!item.children) return rowLink;

  const activeChild = activeChildHref(pathname, search, item.children);

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
            const cActive = c.href === activeChild;
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

/** Live counts for nav badges, fetched on the server and handed in — NavLinks is a client component
 *  and must never reach for data itself. */
export type NavCounts = Partial<Record<NavBadgeKey, number>>;

export function NavLinks({ onNavigate, counts }: { onNavigate?: () => void; counts?: NavCounts }) {
  return (
    <nav className="flex flex-col gap-4 px-3">
      {NAV_GROUPS.map((group, gi) => (
        <div key={gi} className="flex flex-col gap-1">
          {group.label && (
            <p className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{group.label}</p>
          )}
          {group.items.map((item) => (
            <Item counts={counts} key={item.href} item={item} onNavigate={onNavigate} />
          ))}
        </div>
      ))}
    </nav>
  );
}
