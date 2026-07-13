"use client";

import * as React from "react";
import type { Config, Fields } from "@measured/puck";
import {
  SECTION_DEFAULTS,
  heroSlides,
  HERO_INTERVAL_MS,
  type HeroConfig,
  type SectionConfigMap,
} from "@tokophi/sections";
import { puckConfig } from "@/lib/theme/puck-config";

// ADR 0009 — the Hero became a 3-slide carousel (see apps/storefront/src/components/sections/Hero.astro).
// This file is the EDITOR half of that change: the slides array field + a WYSIWYG-ish preview.
//
// Why it lives here and not in lib/theme/puck-config.tsx (where the other 7 sections declare their
// fields): lib/ is being worked on by another agent right now, so the hero's editor config is
// composed ON TOP of the shared `puckConfig` instead of edited into it. It is a pure override —
// same `SectionType` key, same @tokophi/sections config shape, so nothing about the registry
// contract changes. FOLLOW-UP: fold `heroFields` + `HeroPreview` back into
// lib/theme/puck-config.tsx + components/theme/sections/Hero.tsx once that file is free.

const FOCAL_OPTIONS = [
  { label: "Tengah", value: "center" },
  { label: "Kiri", value: "left" },
  { label: "Kanan", value: "right" },
];

const heroFields: Fields<HeroConfig> = {
  badge: { type: "text", label: "Label Badge (kosong = sembunyi)" },
  slides: {
    type: "array",
    label: "Slide (maks. 5 — bergantian otomatis)",
    max: 5,
    getItemSummary: (slide, i) => slide?.heading || `Slide ${(i ?? 0) + 1}`,
    defaultItemProps: {
      imageUrl: "",
      heading: "Judul Slide",
      subheading: "Satu kalimat singkat tentang koleksi ini.",
      ctaLabel: "Belanja Sekarang",
      ctaHref: "/kategori/dress",
      focal: "center",
    },
    arrayFields: {
      imageUrl: { type: "text", label: "URL Gambar (mis. /hero/hero-1.webp — kosong = gradasi warna brand)" },
      heading: { type: "text", label: "Judul" },
      subheading: { type: "textarea", label: "Sub-judul" },
      ctaLabel: { type: "text", label: "Teks Tombol" },
      ctaHref: { type: "text", label: "Link Tombol" },
      focal: { type: "select", label: "Fokus Gambar (bagian yang dipertahankan saat dipotong)", options: FOCAL_OPTIONS },
    },
  },
  intervalMs: { type: "number", label: "Ganti Slide Setiap (milidetik, 0 = tidak berganti)", min: 0, max: 30000 },
  align: {
    type: "select",
    label: "Perataan Teks",
    options: [
      { label: "Kiri", value: "left" },
      { label: "Tengah", value: "center" },
    ],
  },
  ratingText: { type: "text", label: "Teks Rating/Sosial (kosong = sembunyi)" },
};

// Preview approximation of the storefront's rendered output (see the Astro component for the real
// render). No autoplay here on purpose — a hero that kept rotating while you edit slide 3 would be
// unusable; the dots let the merchant park the preview on the slide they're editing.
function HeroPreview(props: HeroConfig) {
  const slides = heroSlides(props);
  const [index, setIndex] = React.useState(0);
  const active = slides[Math.min(index, slides.length - 1)] ?? slides[0];
  const objectPosition = { left: "left center", center: "center", right: "right center" }[active.focal ?? "center"];

  return (
    <section className="bg-gradient-to-b from-stone-100 to-white">
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-6 py-14 md:grid-cols-[1.15fr_1fr]">
        <div className={props.align === "center" ? "text-center" : "text-left"}>
          {props.badge && (
            <span className="mb-6 inline-flex rounded-full bg-white px-3.5 py-1.5 text-xs font-medium text-rose-800 ring-1 ring-rose-200">
              {props.badge}
            </span>
          )}
          <h1 className="text-4xl font-semibold leading-tight tracking-tight text-stone-900">{active.heading}</h1>
          <p className="mt-5 max-w-md text-stone-500">{active.subheading}</p>
          {active.ctaLabel && (
            <div className={`mt-8 flex gap-3 ${props.align === "center" ? "justify-center" : ""}`}>
              <span className="rounded-full bg-rose-800 px-7 py-3 text-sm font-semibold text-white">
                {active.ctaLabel}
              </span>
            </div>
          )}
          <div className={`mt-9 flex items-center gap-4 ${props.align === "center" ? "justify-center" : ""}`}>
            {slides.length > 1 && (
              <div className="flex items-center gap-2">
                {slides.map((slide, i) => (
                  <button
                    key={i}
                    type="button"
                    aria-label={`Lihat slide ${i + 1}`}
                    onClick={(e) => {
                      e.stopPropagation(); // don't let Puck treat the click as "select this section"
                      setIndex(i);
                    }}
                    className={`h-1.5 rounded-full transition-all ${
                      i === index ? "w-8 bg-rose-800" : "w-2.5 bg-rose-200 hover:bg-rose-300"
                    }`}
                  />
                ))}
              </div>
            )}
            {props.ratingText && <p className="text-sm text-stone-500">{props.ratingText}</p>}
          </div>
        </div>

        <div className="relative aspect-[9/10] overflow-hidden rounded-2xl bg-gradient-to-br from-rose-100 via-rose-200 to-rose-50 shadow-xl ring-1 ring-stone-200">
          {active.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- editor preview of an arbitrary URL
            <img
              src={active.imageUrl}
              alt=""
              style={{ objectPosition }}
              // Same graceful degradation as the storefront: a URL that doesn't resolve (very common
              // in the editor — the file lives in the STOREFRONT's public dir, not the admin's)
              // leaves the brand gradient showing instead of a broken-image icon.
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

/** `puckConfig` with the hero swapped for its carousel-aware editor config. */
export const builderConfig: Config<SectionConfigMap> = {
  ...puckConfig,
  components: {
    ...puckConfig.components,
    hero: {
      ...puckConfig.components.hero,
      label: "Hero (Carousel)",
      fields: heroFields,
      defaultProps: { ...SECTION_DEFAULTS.hero, intervalMs: SECTION_DEFAULTS.hero.intervalMs ?? HERO_INTERVAL_MS },
      render: (props) => <HeroPreview {...props} />,
    },
  },
};
