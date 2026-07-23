import type { LookbookConfig } from "@tokophi/sections";

// EDITOR PREVIEW — mirrors apps/storefront/src/components/sections/Lookbook.astro: a centred heading
// (+ optional description) over ONE wide banner. Deliberately simple, no carousel. An empty `imageUrl`
// renders the brand-tinted panel, never a broken frame — the same fallback the storefront uses.
export function Lookbook({ heading, description, imageUrl }: LookbookConfig) {
  return (
    <section className="mx-auto max-w-7xl px-6 py-12">
      {(heading || description) && (
        <div className="mx-auto mb-8 max-w-2xl text-center">
          {heading && (
            <h2 className="font-display text-3xl font-semibold text-ink sm:text-4xl">{heading}</h2>
          )}
          {description && <p className="mt-3 text-base leading-relaxed text-ink/60">{description}</p>}
        </div>
      )}
      {/* One wide banner (21:9), thin `rounded-md` to match the flat cards + bento tiles. */}
      <div className="relative aspect-[21/9] overflow-hidden rounded-md bg-brand-100">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- editor preview of an arbitrary URL
          <img src={imageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <span
            className="block h-full w-full bg-gradient-to-br from-brand-100 to-brand-200"
            aria-hidden="true"
          />
        )}
      </div>
    </section>
  );
}
