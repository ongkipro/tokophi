"use client";

import * as React from "react";
import { heroSlides, type HeroConfig } from "@tokophi/sections";

// ADR 0009 — Hero section (admin/editor half). Preview approximation of the storefront's rendered
// output (own Tailwind palette here, not the storefront's brand tokens — see
// apps/storefront/src/components/sections/Hero.astro for the real render). Kept visually close on
// purpose: same split layout (copy column + contained portrait image panel) so the builder stays
// WYSIWYG-ish.
//
// The slides come from `heroSlides()` (@tokophi/sections) — the SAME normaliser the Astro renderer
// calls, so the editor and the storefront can never disagree about what a saved hero means (a hero
// saved before the carousel existed has no `slides`, only the flat legacy fields; `heroSlides()`
// turns it into a single slide). Never read `config.slides` directly here.
//
// NO autoplay in the editor on purpose — a hero that kept rotating while the merchant edits slide 3
// would be unusable. The dots let them park the preview on the slide they're working on.
export function Hero(props: HeroConfig) {
  const { align, badge, ratingText } = props;
  const slides = heroSlides(props);
  const [index, setIndex] = React.useState(0);
  const active = slides[Math.min(index, slides.length - 1)] ?? slides[0];
  const dotsRef = React.useRef<HTMLDivElement>(null);

  // The dots are wired with a NATIVE listener, not React's onClick: Puck renders the canvas by
  // portalling this tree into a preview <iframe>, and React's synthetic events are delegated at the
  // root container — which lives in the PARENT document, so a click inside the iframe never reaches
  // it (onClick simply never fires here). A listener attached to the real DOM node does.
  React.useEffect(() => {
    const el = dotsRef.current;
    if (!el) return;
    const onClick = (e: MouseEvent) => {
      const dot = (e.target as HTMLElement).closest<HTMLElement>("[data-hero-dot]");
      if (!dot) return;
      e.stopPropagation(); // don't let Puck read the click as "select this section"
      setIndex(Number(dot.dataset.index));
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, []);
  const objectPosition = { left: "left center", center: "center", right: "right center" }[
    active.focal ?? "center"
  ];

  return (
    <section className="bg-gradient-to-b from-stone-100 to-white">
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-6 py-14 md:grid-cols-[1.15fr_1fr]">
        <div className={align === "center" ? "text-center" : "text-left"}>
          {badge && (
            <span className="mb-6 inline-flex rounded-full bg-white px-3.5 py-1.5 text-xs font-medium text-rose-800 ring-1 ring-rose-200">
              {badge}
            </span>
          )}
          <h1 className="text-4xl font-semibold leading-tight tracking-tight text-stone-900">
            {active.heading}
          </h1>
          <p className={`mt-5 max-w-md text-stone-500 ${align === "center" ? "mx-auto" : ""}`}>
            {active.subheading}
          </p>
          {active.ctaLabel && (
            <div className={`mt-8 flex gap-3 ${align === "center" ? "justify-center" : ""}`}>
              <span className="rounded-full bg-rose-800 px-7 py-3 text-sm font-semibold text-white">
                {active.ctaLabel}
              </span>
            </div>
          )}
          <div
            className={`mt-9 flex items-center gap-4 ${align === "center" ? "justify-center" : ""}`}
          >
            {slides.length > 1 && (
              <div ref={dotsRef} className="flex items-center gap-2">
                {slides.map((slide, i) => (
                  <button
                    key={i}
                    type="button"
                    // Puck blanks pointer-events inside canvas components; lib/theme/puck-theme.css
                    // re-enables it for this attribute alone so the dots stay clickable.
                    data-hero-dot
                    data-index={i}
                    aria-label={`Lihat slide ${i + 1}: ${slide.heading}`}
                    aria-pressed={i === index}
                    className={`h-1.5 rounded-full transition-all ${
                      i === index ? "w-8 bg-rose-800" : "w-2.5 bg-rose-200 hover:bg-rose-300"
                    }`}
                  />
                ))}
              </div>
            )}
            {ratingText && <p className="text-sm text-stone-500">{ratingText}</p>}
          </div>
        </div>

        {/* The gradient is the graceful-degradation layer: a missing/failed image leaves the brand
            tint showing instead of a broken-image icon — same behaviour as the storefront. */}
        <div className="relative aspect-[9/10] overflow-hidden rounded-2xl bg-gradient-to-br from-rose-100 via-rose-200 to-rose-50 shadow-xl ring-1 ring-stone-200">
          {active.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- editor preview of an arbitrary URL
            <img
              key={active.imageUrl}
              src={active.imageUrl}
              alt=""
              style={{ objectPosition }}
              // Hero images live in the STOREFRONT's public dir, so they very often don't resolve
              // inside the admin — hide the broken <img> and let the gradient show through.
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}
        </div>
      </div>
    </section>
  );
}
