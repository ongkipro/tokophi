// Deterministic Indonesian → Google Product Category suggester (ADR 0011).
//
// Auto-suggest: match product keywords in a title (+ its merchant category) to a Google Product Taxonomy
// leaf id, so the seller confirms one suggestion instead of hunting a 5,595-node tree. Covers the common
// Indonesian marketplace verticals — fashion, beauty/skincare, electronics, F&B, baby, toys, health,
// accessories. A SUGGESTION only — the picker is the source of truth and the seller can always override.
// Offline, zero-cost, deterministic. A general AI classifier is a clean later swap behind this same seam.
// Extend by adding a { id, path, name, kw } rule; ids are verified against the committed taxonomy file.
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

  // --- Fashion accessories ---
  { id: 187, path: "Apparel & Accessories > Shoes", name: "Shoes", kw: ["sepatu", "sandal", "sneakers", "heels", "flat shoes", "boots", "wedges", "loafers"] },
  { id: 3032, path: "Apparel & Accessories > Handbags, Wallets & Cases > Handbags", name: "Handbags", kw: ["tas wanita", "handbag", "tote bag", "sling bag", "clutch", "tas selempang"] },
  { id: 100, path: "Luggage & Bags > Backpacks", name: "Backpacks", kw: ["ransel", "backpack", "tas punggung", "tas ransel"] },
  { id: 2668, path: "Apparel & Accessories > Handbags, Wallets & Cases > Wallets & Money Clips", name: "Wallets", kw: ["dompet", "wallet"] },
  { id: 201, path: "Apparel & Accessories > Jewelry > Watches", name: "Watches", kw: ["jam tangan", "smartwatch", "arloji"] },
  { id: 178, path: "Apparel & Accessories > Clothing Accessories > Sunglasses", name: "Sunglasses", kw: ["kacamata hitam", "sunglasses"] },

  // --- Beauty & personal care ---
  { id: 567, path: "Health & Beauty > Personal Care > Cosmetics > Skin Care", name: "Skin Care", kw: ["skincare", "serum", "toner", "moisturizer", "pelembab", "essence", "facial wash", "masker wajah"] },
  { id: 2844, path: "Health & Beauty > Personal Care > Cosmetics > Skin Care > Sunscreen", name: "Sunscreen", kw: ["sunscreen", "tabir surya", "sunblock"] },
  { id: 477, path: "Health & Beauty > Personal Care > Cosmetics > Makeup", name: "Makeup", kw: ["makeup", "make up", "lipstik", "lip cream", "bedak", "foundation", "maskara", "eyeliner", "blush on", "concealer", "kutek", "cushion"] },
  { id: 474, path: "Health & Beauty > Personal Care > Cosmetics > Bath & Body", name: "Bath & Body", kw: ["sabun", "body wash", "body lotion", "lulur", "deodoran", "parfum", "cologne", "body mist"] },
  { id: 486, path: "Health & Beauty > Personal Care > Hair Care", name: "Hair Care", kw: ["shampoo", "sampo", "kondisioner", "conditioner", "hair tonic", "minyak rambut", "serum rambut"] },

  // --- Health ---
  // "vitamin" alone is ambiguous — a "Serum Vitamin C" is Skin Care, so match only the supplement forms.
  { id: 525, path: "Health & Beauty > Health Care > Fitness & Nutrition > Vitamins & Supplements", name: "Vitamins & Supplements", kw: ["suplemen", "multivitamin", "kolagen", "collagen", "vitamin c 1000", "vitamin d3", "kaplet"] },

  // --- Electronics ---
  { id: 267, path: "Electronics > Communications > Telephony > Mobile Phones", name: "Mobile Phones", kw: ["handphone", "smartphone", "ponsel", "iphone", "hp android"] },
  { id: 328, path: "Electronics > Computers > Laptops", name: "Laptops", kw: ["laptop", "notebook", "macbook", "ultrabook"] },
  { id: 543626, path: "Electronics > Audio > Audio Components > Headphones & Headsets > Headphones", name: "Headphones", kw: ["headphone", "headset", "earphone", "earbuds", "handsfree"] },

  // --- Food & beverages ---
  { id: 1868, path: "Food, Beverages & Tobacco > Beverages > Coffee", name: "Coffee", kw: ["kopi", "coffee", "arabika", "robusta", "espresso"] },
  { id: 2073, path: "Food, Beverages & Tobacco > Beverages > Tea & Infusions", name: "Tea", kw: ["teh celup", "teh hijau", "green tea", "matcha", "teh herbal"] },
  { id: 423, path: "Food, Beverages & Tobacco > Food Items > Snack Foods", name: "Snack Foods", kw: ["keripik", "camilan", "kerupuk", "makaroni", "snack"] },

  // --- Baby & kids ---
  { id: 551, path: "Baby & Toddler > Diapering > Diapers", name: "Diapers", kw: ["popok", "diapers", "pampers"] },
  { id: 537, path: "Baby & Toddler", name: "Baby & Toddler", kw: ["perlengkapan bayi", "baby", "bayi"] },
  { id: 1253, path: "Toys & Games > Toys", name: "Toys", kw: ["mainan", "boneka", "lego", "puzzle"] },
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

// --- gender (ADR 0011 Phase 2) — Google feed `gender` attribute -------------------------------------
const FEMALE_KW = ["wanita", "perempuan", "cewek", "gamis", "hijab", "khimar", "kerudung", "jilbab", "gaun", "kebaya", "daster", "bra", "lingerie", "bralette"];
const MALE_KW = ["pria", "laki-laki", "laki laki", "cowok", "koko"];

/** Guess the Google `gender` from product text. Returns "female"/"male", or null when unclear (the feed
 *  then omits it or the seller sets it). Longest-match wins so "laki-laki" beats a stray "laki". */
export function suggestGender(...texts: Array<string | null | undefined>): "female" | "male" | null {
  const hay = texts.filter(Boolean).join(" ").toLowerCase();
  if (!hay) return null;
  let g: { v: "female" | "male"; len: number } | null = null;
  for (const kw of FEMALE_KW) if (hay.includes(kw) && (!g || kw.length > g.len)) g = { v: "female", len: kw.length };
  for (const kw of MALE_KW) if (hay.includes(kw) && (!g || kw.length > g.len)) g = { v: "male", len: kw.length };
  return g?.v ?? null;
}
