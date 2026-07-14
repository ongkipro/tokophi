import type { TestimoniConfig } from "@tokophi/sections";

// ADR 0009 — Testimoni (admin/editor half). The registry default is now `items: []`: it used to ship
// two INVENTED customers with names and 5-star ratings, which a merchant published the moment they
// dragged the section on, without typing a character. A testimonial is an advertising claim.
//
// So an empty list is the NORMAL state here, and the canvas must SAY so rather than render an empty
// husk — and it must never draw a placeholder card, because a fake card in the builder is exactly how
// a fake testimonial ends up in the shop. The storefront renders nothing at all when the list is empty
// (components/sections/Testimoni.astro), and the preview has to agree with it.
export function Testimoni({ heading, items }: TestimoniConfig) {
  const list = items ?? [];

  if (list.length === 0) {
    return (
      <section className="rounded-2xl bg-stone-50 p-8">
        <h2 className="mb-6 text-center text-xl font-semibold text-stone-900">{heading}</h2>
        <div className="rounded-xl border-2 border-dashed border-stone-200 px-6 py-10 text-center">
          <p className="text-sm font-medium text-stone-700">Belum ada testimoni</p>
          <p className="mt-1 text-sm text-stone-500">
            Tambahkan kutipan pelanggan <span className="font-medium">asli</span> di panel kanan.
            Selama kosong, bagian ini tidak tampil di toko.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl bg-stone-50 p-8">
      <h2 className="mb-6 text-center text-xl font-semibold text-stone-900">{heading}</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((item, i) => (
          <figure key={i} className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-stone-100">
            <div className="mb-2 flex items-center gap-1.5 text-amber-400" aria-hidden="true">
              <span>
                {"\u2605".repeat(item.rating)}
                <span className="text-stone-200">{"\u2605".repeat(5 - item.rating)}</span>
              </span>
              <span className="text-xs font-medium text-stone-400">{item.rating}/5</span>
            </div>
            <blockquote className="text-sm text-stone-700">&ldquo;{item.quote}&rdquo;</blockquote>
            <figcaption className="mt-3 text-sm font-medium text-stone-900">- {item.name}</figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
