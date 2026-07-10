import type { MarqueeConfig } from "@tokophi/sections";

// Static preview (no scroll animation in the editor canvas) — the storefront's Astro
// counterpart is the one that actually animates via CSS.
export function Marquee({ text }: MarqueeConfig) {
  return (
    <section className="overflow-hidden bg-stone-900 py-4">
      <p className="whitespace-nowrap text-center text-lg font-semibold text-white">
        {Array(4).fill(text).join("  ·  ")}
      </p>
    </section>
  );
}
