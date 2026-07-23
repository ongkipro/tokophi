import type { ImageTextConfig } from "@tokophi/sections";

export function ImageText({
  heading,
  body,
  imageUrl,
  imageSide,
  eyebrow,
  ctaLabel,
  ctaHref,
}: ImageTextConfig) {
  const image = (
    <div className="aspect-[4/3] overflow-hidden rounded-3xl bg-gradient-to-br from-brand-100 to-brand-200 ring-1 ring-line">
      {imageUrl && <img src={imageUrl} alt="" className="h-full w-full object-cover" />}
    </div>
  );
  const text = (
    <div className="flex flex-col justify-center gap-3">
      {eyebrow && <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">{eyebrow}</p>}
      <h2 className="text-2xl font-semibold text-ink">{heading}</h2>
      <p className="text-ink/70">{body}</p>
      {/* Optional CTA — the storefront's arrow-in-circle pill (bg-ink, cream text). Only when set. */}
      {ctaLabel && (
        <a
          href={ctaHref || undefined}
          className="mt-2 inline-flex items-center gap-3 self-start rounded-full bg-ink py-2 pl-2 pr-6 text-sm font-semibold uppercase tracking-wide text-cream shadow-lg"
        >
          <span className="flex size-9 items-center justify-center rounded-full text-cream ring-1 ring-cream/25">
            <svg
              viewBox="0 0 24 24"
              className="size-4 fill-none stroke-current"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          {ctaLabel}
        </a>
      )}
    </div>
  );
  return (
    <section className="grid grid-cols-2 gap-8 p-6">
      {imageSide === "right" ? (
        <>
          {text}
          {image}
        </>
      ) : (
        <>
          {image}
          {text}
        </>
      )}
    </section>
  );
}
