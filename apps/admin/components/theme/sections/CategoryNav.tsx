import type { CategoryNavConfig } from "@tokophi/sections";

// EDITOR PREVIEW ONLY. Mirrors the storefront redesign (CategoryNav.astro, owner 2026-07-23): small
// round avatars → LARGE image banners. Each card is `aspect-[4/5]`, thin `rounded-md`, FRAMELESS (no
// ring, no hover shadow), with the name on a bottom scrim. The live storefront lays up to four in a
// row and turns the row into a horizontal scroller past four; the canvas just shows a 4-up grid.
export function CategoryNav({ items }: CategoryNavConfig) {
  return (
    <section className="p-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {items.map((item, i) => (
          <div
            key={i}
            className="group relative block aspect-[4/5] overflow-hidden rounded-md bg-gradient-to-br from-brand-100 to-brand-200"
          >
            {item.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- editor preview of an arbitrary URL
              <img src={item.imageUrl} alt="" className="h-full w-full object-cover" />
            )}
            {/* name over a bottom scrim, white — the same treatment as the storefront banner */}
            <span className="absolute inset-0 bg-gradient-to-t from-ink/80 via-ink/10 to-transparent" />
            <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-4">
              <span className="text-lg font-semibold text-white drop-shadow-sm">{item.label}</span>
              <svg
                viewBox="0 0 24 24"
                className="size-5 shrink-0 fill-none stroke-white/90"
                strokeWidth={1.75}
                aria-hidden="true"
              >
                <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
