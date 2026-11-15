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
    <div className="aspect-[4/3] overflow-hidden rounded-3xl bg-gradient-to-br from-zinc-100 to-zinc-200 ring-1 ring-line">
      {imageUrl && <img src={imageUrl} alt="" className="h-full w-full object-cover" />}
    </div>
  );
  const text = (
    <div className="flex flex-col justify-center gap-3">
      {eyebrow && <p className="text-sm text-muted-foreground">{eyebrow}</p>}
      <h2 className="font-display text-[1.375rem] font-semibold leading-tight tracking-[-0.01em] text-balance text-ink sm:text-[1.75rem]">{heading}</h2>
      <p className="text-ink/70">{body}</p>
      {/* Optional CTA — mirrors ImageText.astro (redesign C): one solid ink button, no arrow ring. */}
      {ctaLabel && (
        <a href={ctaHref || undefined} className="inline-flex min-h-12 items-center justify-center rounded-lg bg-ink px-6 text-[0.9375rem] font-semibold text-cream transition-colors hover:bg-ink/90 mt-3 self-start">
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
