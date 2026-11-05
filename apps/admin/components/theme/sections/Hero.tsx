"use client";

import * as React from "react";
import { heroSlides, type HeroConfig } from "@tokophi/sections";

// ADR 0009 — Hero section (admin/editor half). Preview approximation of the storefront's rendered
// output (own Tailwind palette here, not the storefront's brand tokens — see
// apps/storefront/src/components/sections/Hero.astro for the real render). Kept visually close on
// purpose: same full-bleed layout (image as the section background, copy on top of it) so the
// builder stays WYSIWYG-ish, now using the storefront's real `ink`/`brand` tokens (added to the
// admin's globals.css @theme block).
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
    // `bg-ink` is not decoration: the copy is white, so it is what keeps the text legible when an image
    // 404s or a slide has no imageUrl — which is the COMMON case in here, since hero images live in the
    // storefront's public dir and usually don't resolve inside the admin. Matches Hero.astro's `bg-ink`.
    <section className="relative isolate flex min-h-[28rem] flex-col overflow-hidden bg-ink">
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
      <div className="absolute inset-0 -z-10 bg-gradient-to-t from-ink/90 via-ink/55 to-ink/30" />
      {!centered && (
        <div className="absolute inset-0 -z-10 hidden bg-gradient-to-r from-ink/80 via-ink/35 to-transparent md:block" />
      )}

      {/* Content column — flex-1 so the trust strip can sit as a real flex child at the bottom, exactly
          like Hero.astro (flex-col: content grows, strip pinned under it). */}
      <div className="relative flex flex-1 items-end md:items-center">
        <div className="mx-auto w-full max-w-6xl px-6 py-10 md:py-16">
        <div className={`max-w-xl ${centered ? "mx-auto text-center" : "text-left"}`}>
          {badge && (
            <p className="mb-2 text-sm font-medium text-white/85">{badge}</p>
          )}
          {/* Same type as Hero.astro's HEADING_CLASS (redesign C): 28 → 40 → 48px, -0.02em. */}
          <h1 className="font-display text-[1.75rem] font-semibold leading-[1.15] tracking-[-0.02em] text-balance text-white sm:text-4xl lg:text-5xl">
            {active.heading}
          </h1>
          <p className={`mt-3 max-w-md text-base leading-relaxed text-white/90 sm:text-lg ${centered ? "mx-auto" : ""}`}>
            {active.subheading}
          </p>
          {active.ctaLabel && (
            <div className={`mt-6 flex flex-wrap items-center gap-2 sm:gap-4 ${centered ? "justify-center" : ""}`}>
              {/* Mirrors Hero.astro (redesign C): ONE solid white button for the slide's CTA, and the
                  universal "Lihat semua produk" as a quiet text link beside it. */}
              <span className="inline-flex min-h-12 items-center justify-center rounded-lg bg-white px-6 text-[0.9375rem] font-semibold text-ink">
                {active.ctaLabel}
              </span>
              <span className="inline-flex min-h-12 items-center gap-1.5 px-2 text-[0.9375rem] font-medium text-white">
                Lihat semua produk
                <ArrowRightIcon />
              </span>
            </div>
          )}
          <div className={`mt-6 flex items-center gap-4 ${centered ? "justify-center" : ""}`}>
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
        <div className="relative z-10 border-t border-white/15 bg-ink/30 backdrop-blur-md">
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
