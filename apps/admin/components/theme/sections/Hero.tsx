import type { HeroConfig } from "@tokophi/sections";

// Preview approximation of the storefront's rendered output (own Tailwind palette here,
// not @tokophi/data's storefront tokens — see apps/storefront/src/components/sections/Hero.astro
// for the real render). Kept visually close on purpose so the builder stays WYSIWYG-ish.
export function Hero({ heading, subheading, imageUrl, ctaLabel, ctaHref, align, badge, ratingText }: HeroConfig) {
  return (
    <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-stone-300 to-stone-100">
      {imageUrl && (
        <img src={imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
      <div
        className={`relative flex min-h-[380px] flex-col justify-end gap-3 p-10 text-white ${
          align === "center" ? "items-center text-center" : "items-start text-left"
        }`}
      >
        {badge && (
          <span className="inline-flex rounded-full bg-rose-600 px-3 py-1 text-xs font-semibold uppercase tracking-wide">
            {badge}
          </span>
        )}
        <h1 className="max-w-xl text-4xl font-semibold tracking-tight">{heading}</h1>
        <p className="max-w-md text-white/85">{subheading}</p>
        <a
          href={ctaHref}
          className="mt-2 inline-flex rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-stone-900 shadow-sm transition hover:bg-white/90"
        >
          {ctaLabel}
        </a>
        {ratingText && <p className="mt-1 text-sm text-white/80">{ratingText}</p>}
      </div>
    </section>
  );
}
