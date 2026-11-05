import type { CollectionBentoConfig } from "@tokophi/sections";

// EDITOR PREVIEW ONLY. The live section (apps/storefront) fills this mosaic with the store's REAL
// collections at render time — data the Puck canvas does not have. So here we show the LAYOUT with
// placeholder tiles and say so, rather than pretend to know the store's collections. The span pattern
// mirrors the storefront (mobile 2-up with a full-width band; here we just show the desktop shape).
const PLACEHOLDER = ["1", "2", "3", "4", "5", "6"];
const DESKTOP = [1, 2, 1, 2, 1, 1];

export function CollectionBento({ heading }: CollectionBentoConfig) {
  return (
    <section className="mx-auto max-w-5xl p-6">
      {heading ? <h2 className="mb-5 font-display text-[1.375rem] font-semibold leading-tight tracking-[-0.01em] text-balance text-ink sm:text-[1.75rem]">{heading}</h2> : null}
      <div className="grid auto-rows-[8rem] grid-cols-4 gap-3">
        {PLACEHOLDER.map((_, i) => (
          <div
            key={i}
            className={
              (DESKTOP[i % DESKTOP.length] === 2 ? "col-span-2 " : "col-span-1 ") +
              // FRAMELESS + thin radius — mirrors CollectionBento.astro (owner 2026-07-23): `rounded-md`,
              // no `ring-1`. Six tiles = the storefront's two desktop rows (1+2+1 then 2+1+1).
              "relative overflow-hidden rounded-sm bg-gradient-to-br from-zinc-100 to-zinc-200"
            }
          >
            {/* name chip — the storefront's `bg-cream/95` solid pill, ink text */}
            <span className="absolute bottom-3 left-3 rounded-sm bg-cream px-2.5 py-1 text-sm font-medium text-ink">
              Koleksi
            </span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-ink/60">
        Terisi otomatis dari koleksi tokomu (maks. 6) saat tampil di storefront.
      </p>
    </section>
  );
}
