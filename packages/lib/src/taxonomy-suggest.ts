// Deterministic Indonesian-fashion → Google Product Category suggester (ADR 0011).
//
// Phase 1 auto-suggest: match garment keywords in a product's title (+ its merchant category) to a
// Google Product Taxonomy leaf id, so the seller confirms one suggestion instead of hunting a
// 5,595-node tree. This is a SUGGESTION only — the picker is the source of truth and the seller can
// always override. Offline, zero-cost, deterministic. A general AI classifier is a clean Phase-2 swap
// behind this same `suggestGoogleCategory` seam.
//
// ⚠️ Keywords are matched as substrings on a lowercased haystack, longest-first, so "celana pendek"
// (Shorts) beats "celana" (Pants). Keep the more specific term LONGER or listed to win the tie.

export type TaxonomySuggestion = { id: number; path: string; name: string };

type Rule = { id: number; path: string; name: string; kw: string[] };

// Ordered by how confidently the keyword names a garment TYPE. All ids verified against the committed
// Google taxonomy (2021-09-21). `syari`/`muslim` are ADJECTIVES (modest), never garment types — a
// "Gamis Syari" is a Dress, so those words are deliberately absent here.
const RULES: Rule[] = [
  { id: 5250, path: "Apparel & Accessories > Clothing > One-Pieces > Jumpsuits & Rompers", name: "Jumpsuits & Rompers", kw: ["jumpsuit", "romper", "overall"] },
  { id: 177, path: "Apparel & Accessories > Clothing Accessories > Scarves & Shawls", name: "Scarves & Shawls", kw: ["hijab", "khimar", "kerudung", "jilbab", "pashmina", "bergo"] },
  { id: 207, path: "Apparel & Accessories > Clothing > Shorts", name: "Shorts", kw: ["celana pendek", "hotpants"] },
  { id: 5598, path: "Apparel & Accessories > Clothing > Outerwear > Coats & Jackets", name: "Coats & Jackets", kw: ["blazer", "jaket", "jacket", "mantel", "cardigan", "kardigan", "outer", "coat"] },
  { id: 2580, path: "Apparel & Accessories > Clothing > Sleepwear & Loungewear > Pajamas", name: "Pajamas", kw: ["piyama", "pajama", "pajamas", "daster", "loungewear"] },
  { id: 1581, path: "Apparel & Accessories > Clothing > Skirts", name: "Skirts", kw: ["rok", "plisket", "skirt"] },
  { id: 204, path: "Apparel & Accessories > Clothing > Pants", name: "Pants", kw: ["celana", "kulot", "pants", "legging", "jeans", "jogger", "palazzo"] },
  { id: 1594, path: "Apparel & Accessories > Clothing > Suits", name: "Suits", kw: ["setelan"] },
  { id: 2271, path: "Apparel & Accessories > Clothing > Dresses", name: "Dresses", kw: ["dress", "gaun", "gamis", "terusan", "midi dress", "maxi dress", "bodycon"] },
  { id: 212, path: "Apparel & Accessories > Clothing > Shirts & Tops", name: "Shirts & Tops", kw: ["blouse", "blus", "atasan", "kemeja", "kaos", "tunik", "tunic", "tank top", "crop top"] },
];

/** Suggest a Google category from any product text (title, then merchant category). Longest keyword
 *  match wins; returns null when nothing matches (honest — better a blank than a wrong feed category). */
export function suggestGoogleCategory(...texts: Array<string | null | undefined>): TaxonomySuggestion | null {
  const hay = texts.filter(Boolean).join(" ").toLowerCase();
  if (!hay) return null;
  let best: { rule: Rule; kwLen: number } | null = null;
  for (const rule of RULES) {
    for (const kw of rule.kw) {
      if (hay.includes(kw) && (!best || kw.length > best.kwLen)) best = { rule, kwLen: kw.length };
    }
  }
  return best ? { id: best.rule.id, path: best.rule.path, name: best.rule.name } : null;
}
