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
      {heading ? <h2 className="mb-4 text-2xl font-semibold text-stone-800">{heading}</h2> : null}
      <div className="grid auto-rows-[8rem] grid-cols-4 gap-3">
        {PLACEHOLDER.map((_, i) => (
          <div
            key={i}
            className={
              (DESKTOP[i % DESKTOP.length] === 2 ? "col-span-2 " : "col-span-1 ") +
              "relative overflow-hidden rounded-2xl bg-gradient-to-br from-stone-300 to-stone-100 ring-1 ring-stone-200"
            }
          >
            <span className="absolute bottom-2 left-2 rounded-lg bg-white/90 px-2 py-1 text-xs font-medium text-stone-500">
              Koleksi
            </span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-stone-400">
        Terisi otomatis dari koleksi tokomu (maks. 8) saat tampil di storefront.
      </p>
    </section>
  );
}
