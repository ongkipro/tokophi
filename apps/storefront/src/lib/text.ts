/**
 * Trim merchant copy to a length, ALWAYS on a word boundary, with an ellipsis when something was cut.
 *
 * It lived inside Layout.astro for the meta/OG description. The footer needed the same thing and a
 * second copy is how the two drift, so it moved here.
 *
 * Why it is needed at all: the Seller's "Deskripsi singkat" field caps at 160 characters, and a
 * merchant who writes to the cap gets a value that ends mid-word — the demo store's reads
 * "…filosofi lokal dari masing-masing da". Rendered raw that looks like the page broke. Cutting on a
 * space and marking the cut with "…" reads as a summary, which is what it is.
 *
 * Whitespace is collapsed first, so a textarea's stray newlines cannot produce a ragged one-line blurb.
 */
export const clamp = (text: string | null | undefined, max = 155): string => {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  // `lastIndexOf(" ")` is -1 for a single word longer than `max`; slicing to -1 would drop the last
  // character instead of returning nothing sensible, so fall back to the hard cut in that case.
  const space = cut.lastIndexOf(" ");
  return (space > 0 ? cut.slice(0, space) : cut).trimEnd() + "…";
};
