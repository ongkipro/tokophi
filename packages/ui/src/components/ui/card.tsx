import * as React from "react"

import { cn } from "../../lib/utils"

function Card({
  className,
  size = "default",
  ...props
}: React.ComponentProps<"div"> & { size?: "default" | "sm" }) {
  return (
    <div
      data-slot="card"
      data-size={size}
      className={cn(
        "group/card flex flex-col gap-(--card-spacing) overflow-hidden rounded-xl bg-card py-(--card-spacing) text-sm text-card-foreground ring-1 ring-foreground/10 [--card-spacing:--spacing(4)] has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(3)] data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-xl px-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-(--card-spacing)",
        className
      )}
      {...props}
    />
  )
}

/**
 * The card's heading — a real `<h2>`, not a `<div>` that looks like one.
 *
 * ── WHY (N52), MEASURED IN A BROWSER, NOT GREPPED ────────────────────────────────────────────────
 *
 * This was a `<div>`. Logged in to the demo store on 2026-08-05 and walked 52 Seller screens with
 * Playwright, reading `document.querySelectorAll('[data-slot="card-title"]')` and the live heading
 * outline: **103 rendered card titles, every one of them a `<div>`**, and the outline of nearly every
 * screen was the single word `h1`. `apps/admin/lib/admin-h1-floor.test.ts` pins that each route
 * REACHES an `h1` — that is the floor. Above the floor there was nothing: a screen-reader user could
 * not jump between the regions of any admin screen and had to read it linearly, top to bottom.
 *
 * ── WHY THE DEFAULT IS `h2`, AND WHY IT IS A FIXED DEFAULT AND NOT DERIVED ───────────────────────
 *
 * The level is the hard part; the tag is trivial. Three things were measured, not assumed:
 *
 *  1. **No card is nested inside another card.** The same sweep recorded, for every rendered card
 *     title, how many `[data-slot=card]` ancestors it has: **121/121 came back with exactly one**
 *     (103 unique + duplicate routes). The "a card inside a section that already has an `h2` wants
 *     `h3`" case does not exist in this admin. A context provider that derives a level would be an
 *     abstraction with no second case to serve.
 *  2. **The page `h1` really is the parent.** 116 of those titles have the page `PageHeader`'s `h1`
 *     as their nearest preceding heading; 4 (on `/pemasaran`) follow an `h2` that is itself a
 *     hand-rolled card heading in a SIBLING card, not a section that owns them.
 *  3. **`h2` is already what this codebase reached for by hand.** `navigasi-client.tsx`,
 *     `pemasaran/feed-card.tsx`, `crm/page.tsx` and `tema/tema-client.tsx` each hand-rolled a card
 *     heading and each chose `<h2>` with the same reasoning written next to it. A different default
 *     here would have contradicted four screens that already got it right.
 *
 * So: `h2` by default, and a `level` escape hatch for the one shape the sweep found that is NOT
 * "a card under a page title" — `/login` and `/daftar`, where the card IS the page and has no `h1`
 * at all. Those pass `level={1}` and gain a top-level heading they never had.
 *
 * ── WHY THE TYPE SCALE IS UNCHANGED ──────────────────────────────────────────────────────────────
 *
 * A bare `<h2>` inherits `font-size: 1.5em; font-weight: bold; margin: .83em 0` from the UA sheet.
 * It does not here, and that was checked rather than trusted: Tailwind v4's preflight zeroes margins
 * on `*` and sets `font-size: inherit; font-weight: inherit` on `h1`–`h6`, and the class list below
 * pins the size and weight itself. Both censuses — before and after — report the identical computed
 * `16px / 500 / 0px margins` on every one of the 121.
 */
function CardTitle({
  className,
  level = 2,
  ...props
}: React.ComponentProps<"h2"> & { level?: 1 | 2 | 3 | 4 | 5 | 6 }) {
  const Heading = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6"
  return (
    <Heading
      data-slot="card-title"
      className={cn(
        "font-heading text-base leading-snug font-medium group-data-[size=sm]/card:text-sm",
        className
      )}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-(--card-spacing)", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center rounded-b-xl border-t bg-muted/50 p-(--card-spacing)",
        className
      )}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
