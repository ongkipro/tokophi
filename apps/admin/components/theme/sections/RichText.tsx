import type { RichTextConfig } from "@tokophi/sections";

// REDESIGN 2026-07-24 (owner reference #13) — mirrors apps/storefront/src/components/sections/RichText.astro:
// a clean, centred STATEMENT. A small eyebrow, one large display line, an optional supporting line, and
// a quiet UNDERLINED text link (not a pill). Honors the terang/gelap theme.
export function RichText({ heading, body, ctaLabel, ctaHref, theme, eyebrow }: RichTextConfig) {
  const dark = theme === "gelap";
  return (
    <section className={dark ? "bg-ink" : "bg-cream"}>
      <div className="mx-auto max-w-3xl px-6 py-14 text-center sm:py-20">
        {eyebrow && (
          <p
            className={`mb-2 text-sm ${dark ? "text-white/75" : "text-muted-foreground"}`}
          >
            {eyebrow}
          </p>
        )}
        {heading && (
          <h2
            className={`font-display text-2xl font-semibold leading-snug tracking-[-0.01em] text-balance sm:text-3xl ${
              dark ? "text-cream" : "text-ink"
            }`}
          >
            {heading}
          </h2>
        )}
        {body && (
          <p
            className={`mx-auto mt-6 max-w-xl text-base leading-relaxed sm:text-lg ${
              dark ? "text-white/70" : "text-ink/60"
            }`}
          >
            {body}
          </p>
        )}
        {ctaLabel && (
          <a
            href={ctaHref || undefined}
            className={`mt-8 inline-block text-sm font-medium underline decoration-1 underline-offset-4 transition-colors ${
              dark ? "text-cream/90 hover:text-white" : "text-ink/80 hover:text-ink"
            }`}
          >
            {ctaLabel}
          </a>
        )}
      </div>
    </section>
  );
}
