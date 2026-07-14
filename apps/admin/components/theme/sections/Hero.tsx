"use client";

import * as React from "react";
import { heroSlides, type HeroConfig } from "@tokophi/sections";

// ADR 0009 — Hero section (admin/editor half). Preview approximation of the storefront's rendered
// output (own Tailwind palette here, not the storefront's brand tokens — see
// apps/storefront/src/components/sections/Hero.astro for the real render). Kept visually close on
// purpose: same full-bleed layout (image as the section background, copy on top of it) so the
// builder stays WYSIWYG-ish. `stone-900` stands in for the storefront's `ink`.
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

  const centered = align === "center";

  return (
    // `bg-stone-900` is not decoration: the copy is white, so it is what keeps the text legible when
    // an image 404s or a slide has no imageUrl — which is the COMMON case in here, since hero images
    // live in the storefront's public dir and usually don't resolve inside the admin.
    <section className="relative isolate flex min-h-[28rem] items-end overflow-hidden bg-stone-900 md:items-center">
      {active.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- editor preview of an arbitrary URL
        <img
          key={active.imageUrl}
          src={active.imageUrl}
          alt=""
          style={{ objectPosition }}
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
          className="absolute inset-0 -z-10 h-full w-full object-cover"
        />
      )}

      {/* Scrim — mirrors the storefront: a bottom-up wash, plus a left-to-right one when the copy is
          left-aligned so only the text column is darkened. The horizontal wash is desktop-only, and
          narrow viewports drop the copy to the bottom instead — Puck can preview at phone width, so
          the breakpoints have to match the storefront or the builder would lie. */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-t from-stone-900/90 via-stone-900/55 to-stone-900/30" />
      {!centered && (
        <div className="absolute inset-0 -z-10 hidden bg-gradient-to-r from-stone-900/80 via-stone-900/35 to-transparent md:block" />
      )}

      <div className="mx-auto w-full max-w-6xl px-6 py-14 md:py-16">
        <div className={`max-w-xl ${centered ? "mx-auto text-center" : "text-left"}`}>
          {badge && (
            <span className="mb-6 inline-flex rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-medium text-white ring-1 ring-white/30 backdrop-blur-sm">
              {badge}
            </span>
          )}
          <h1 className="text-4xl font-semibold leading-tight tracking-tight text-white">
            {active.heading}
          </h1>
          <p className={`mt-5 max-w-md text-white/85 ${centered ? "mx-auto" : ""}`}>
            {active.subheading}
          </p>
          {active.ctaLabel && (
            <div className={`mt-8 flex gap-3 ${centered ? "justify-center" : ""}`}>
              <span className="rounded-full bg-white px-7 py-3 text-sm font-semibold text-stone-900">
                {active.ctaLabel}
              </span>
            </div>
          )}
          <div className={`mt-9 flex items-center gap-4 ${centered ? "justify-center" : ""}`}>
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
                      i === index ? "w-8 bg-white" : "w-2.5 bg-white/40 hover:bg-white/70"
                    }`}
                  />
                ))}
              </div>
            )}
            {ratingText && <p className="text-sm text-white/75">{ratingText}</p>}
          </div>
        </div>
      </div>
    </section>
  );
}
