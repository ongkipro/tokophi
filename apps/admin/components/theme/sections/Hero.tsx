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
// Small inline arrow — the storefront uses a lucide `ArrowRight`; inlined here to keep the preview
// dependency-free (this file already avoids importing lucide-react).
function ArrowRightIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 fill-none stroke-current" strokeWidth={2} aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Hero(props: HeroConfig) {
  const { align, badge, ratingText, features } = props;
  // TRUST STRIP — only the badges the merchant set; an empty list renders no strip (never an
  // over-promise). Mirrors `featureList` in Hero.astro.
  const featureList = (features ?? []).filter((f) => f.title);
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
    <section className="relative isolate flex min-h-[28rem] flex-col overflow-hidden bg-stone-900">
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

      {/* Content column — flex-1 so the trust strip can sit as a real flex child at the bottom, exactly
          like Hero.astro (flex-col: content grows, strip pinned under it). */}
      <div className="relative flex flex-1 items-end md:items-center">
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
            <div className={`mt-8 flex flex-wrap items-center gap-3 ${centered ? "justify-center" : ""}`}>
              {/* PRIMARY — arrow-in-circle pill (mirrors Hero.astro): a filled pill with a ringed round
                  icon hugging the left edge. */}
              <span className="inline-flex items-center gap-3 rounded-full bg-white py-2 pl-2 pr-6 text-sm font-semibold uppercase tracking-wide text-stone-900 shadow-lg">
                <span className="flex size-9 items-center justify-center rounded-full text-stone-900 ring-1 ring-stone-900/15">
                  <ArrowRightIcon />
                </span>
                {active.ctaLabel}
              </span>
              {/* SECONDARY — the universal "Lihat Semua" browse action, as a ghost arrow-pill. */}
              <span className="inline-flex items-center gap-3 rounded-full border border-white/40 py-2 pl-2 pr-6 text-sm font-semibold uppercase tracking-wide text-white">
                <span className="flex size-9 items-center justify-center rounded-full text-white ring-1 ring-white/40">
                  <ArrowRightIcon />
                </span>
                Lihat Semua
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
      </div>

      {/* TRUST STRIP — a row of icon+title+text badges across the bottom, rendered only when the
          merchant set `features` (empty = no strip). Mirrors Hero.astro; the real render maps each
          `icon` key to a lucide glyph — the preview shows the badge shape. */}
      {featureList.length > 0 && (
        <div className="relative z-10 border-t border-white/15 bg-black/30 backdrop-blur-md">
          <ul className="mx-auto flex max-w-6xl gap-5 overflow-x-auto px-6 py-4">
            {featureList.map((f, i) => (
              <li key={i} className="flex min-w-[12rem] shrink-0 items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-white ring-1 ring-white/20">
                  <span className="size-2 rounded-full bg-white" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold leading-tight text-white">{f.title}</p>
                  {f.text && <p className="mt-0.5 text-xs leading-snug text-white/70">{f.text}</p>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
