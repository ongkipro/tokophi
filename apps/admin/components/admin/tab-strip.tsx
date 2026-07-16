import { cn } from "@tokophi/ui/lib/utils";

/**
 * A tab strip that survives a phone.
 *
 * Admin tab labels carry counts ("Perlu Dikirim 19"), so these strips have no fixed width and they
 * outgrow a phone the moment a label or a number gets longer. Four screens hit it (Pesanan, Saldo,
 * Blog, Diskon — measured at 372–452px against 360/390/414 viewports by `npm run audit:responsive`),
 * so it is a pattern, not four accidents.
 *
 * It SCROLLS rather than wraps or squeezes, and each choice is deliberate:
 *   · squeezing shreds the labels — a filter reading "Ra…" is not a filter, and a count you cannot
 *     read is not a landmark;
 *   · wrapping is what Pesanan tried (`h-9 flex-wrap`) and it is a trap: the height was pinned to one
 *     row while the content took three, so rows 2-3 rendered ON TOP of the toolbar below. A wrapped
 *     strip also eats ~100px of vertical space on the screen with the least of it.
 *   · scrolling is what the storefront's gallery does, and it is the one case `audit-responsive`
 *     deliberately excuses — overflow inside a horizontal scroller is clipped by its box, not the page.
 *
 * `-mx-4 px-4` bleeds it to the screen edge on mobile so the scroll reads as intentional rather than
 * as a strip that got cut off; from `sm` up it sits back inside the page padding.
 *
 * Give the TabsList inside it `w-max` so it keeps its natural width instead of being compressed.
 */
export function TabStrip({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0", className)}>{children}</div>;
}
