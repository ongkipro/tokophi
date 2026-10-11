// Deterministic Indonesian → Google Product Category suggester (ADR 0011).
//
// Auto-suggest: match product keywords in a title (+ its merchant category) to a Google Product Taxonomy
// leaf id, so the seller confirms one suggestion instead of hunting a 5,595-node tree. Covers the common
// Indonesian marketplace verticals — fashion, beauty/skincare, electronics, F&B, baby, toys, health,
// accessories, agriculture/garden. A SUGGESTION only — the picker is the source of truth and the seller can always override.
// Offline, zero-cost, deterministic. A general AI classifier is a clean later swap behind this same seam.
// Extend by adding a { id, path, name, kw } rule; ids are verified against the committed taxonomy file.
//
// ⚠️ Keywords are matched as WHOLE WORDS (never substrings: "rok" must not hit "rokok"/"brokoli", "bra"
// must not hit "zebra"), longest-first, so "celana pendek" (Shorts) beats "celana" (Pants) and
// "serum tanaman" (Fertilizers) beats "serum" (Skin Care). Keep the more specific term LONGER.
//
// ⚠️ Texts are screened IN ORDER — title, then merchant category, then description — and the first
// text with any hit wins. The title names the product; a description mentions everything (a plant
// tonic's copy says "serum", a dress's says "kaos kaki"), so it is only a fallback, never a tie-breaker.

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
  { id: 3032, path: "Apparel & Accessories > Handbags, Wallets & Cases > Handbags", name: "Handbags", kw: ["tas wanita", "handbag", "tote bag", "sling bag", "clutch", "tas selempang", "tas bahu", "shoulder bag"] },
  { id: 100, path: "Luggage & Bags > Backpacks", name: "Backpacks", kw: ["ransel", "backpack", "tas punggung", "tas ransel"] },
  { id: 2668, path: "Apparel & Accessories > Handbags, Wallets & Cases > Wallets & Money Clips", name: "Wallets", kw: ["dompet", "wallet"] },
  { id: 201, path: "Apparel & Accessories > Jewelry > Watches", name: "Watches", kw: ["jam tangan", "smartwatch", "arloji"] },
  { id: 178, path: "Apparel & Accessories > Clothing Accessories > Sunglasses", name: "Sunglasses", kw: ["kacamata hitam", "sunglasses"] },

  // --- Beauty & personal care ---
  { id: 567, path: "Health & Beauty > Personal Care > Cosmetics > Skin Care", name: "Skin Care", kw: ["skincare", "serum", "toner", "moisturizer", "pelembab", "essence", "facial wash", "masker wajah"] },
  { id: 2844, path: "Health & Beauty > Personal Care > Cosmetics > Skin Care > Sunscreen", name: "Sunscreen", kw: ["sunscreen", "tabir surya", "sunblock"] },
  { id: 477, path: "Health & Beauty > Personal Care > Cosmetics > Makeup", name: "Makeup", kw: ["makeup", "make up", "lipstik", "lip cream", "bedak", "foundation", "maskara", "eyeliner", "blush on", "concealer", "kutek", "cushion"] },
  { id: 474, path: "Health & Beauty > Personal Care > Cosmetics > Bath & Body", name: "Bath & Body", kw: ["sabun", "soap", "body wash", "body lotion", "lulur", "deodoran", "parfum", "cologne", "body mist"] },
  { id: 486, path: "Health & Beauty > Personal Care > Hair Care", name: "Hair Care", kw: ["shampoo", "sampo", "kondisioner", "conditioner", "hair tonic", "hair oil", "minyak rambut", "minyak kemiri", "serum rambut", "penumbuh rambut"] },
  { id: 485, path: "Health & Beauty > Personal Care > Feminine Sanitary Supplies", name: "Feminine Sanitary Supplies", kw: ["pembalut", "intimate wash", "intimate spray", "pembersih kewanitaan", "sabun kewanitaan", "menstrual cup"] },

  // --- Health ---
  // "vitamin" and "collagen" alone are ingredients, not products — a "Serum Vitamin C" is Skin Care and a
  // "Kefir Collagen Soap" is soap — so match only the supplement forms.
  { id: 525, path: "Health & Beauty > Health Care > Fitness & Nutrition > Vitamins & Supplements", name: "Vitamins & Supplements", kw: ["suplemen", "multivitamin", "minuman kolagen", "collagen drink", "vitamin c 1000", "vitamin d3", "kaplet"] },

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

  // --- Empty packaging --- (a "Pot Krim" / "Botol Toner" seller sells the CONTAINER; the two-word term
  // out-lengths the cosmetic word it contains. Google has no cosmetic-packaging node; this is the closest.)
  { id: 6919, path: "Luggage & Bags > Luggage Accessories > Travel Bottles & Containers", name: "Travel Bottles & Containers", kw: ["botol kosong", "pot kosong", "pot krim", "pot cream", "pot lulur", "pot acrylic", "pot akrilik", "botol kapsul", "botol putri", "botol polygon", "botol shampo", "botol spray", "botol pump", "jar kaca"] },

  // --- Agriculture & garden --- ("tanaman"-qualified terms out-length the beauty words they contain)
  { id: 113, path: "Home & Garden > Lawn & Garden > Gardening > Fertilizers", name: "Fertilizers", kw: ["pupuk", "fertilizer", "npk", "urea", "kompos cair", "pupuk organik", "nutrisi tanaman", "serum tanaman", "vitamin tanaman", "stimulator", "biostimulan", "zpt", "perangsang buah", "perangsang akar", "pelebat buah", "pertumbuhan tanaman", "pemulihan tanaman"] },
  { id: 2869, path: "Home & Garden > Household Supplies > Pest Control > Pesticides", name: "Pesticides", kw: ["pestisida", "insektisida", "pesticide", "insecticide", "racun hama", "obat hama"] },
  { id: 691, path: "Home & Garden > Lawn & Garden > Gardening > Disease Control", name: "Disease Control", kw: ["fungisida", "fungicide", "bakterisida", "anti kulat", "anti-kulat", "ganoderma"] },
  { id: 3103, path: "Home & Garden > Lawn & Garden > Gardening > Herbicides", name: "Herbicides", kw: ["herbisida", "herbicide", "racun rumput", "pembasmi gulma"] },
  { id: 2802, path: "Home & Garden > Plants > Seeds", name: "Seeds", kw: ["benih", "biji benih", "seeds"] },
  { id: 6762, path: "Home & Garden > Plants > Indoor & Outdoor Plants", name: "Indoor & Outdoor Plants", kw: ["bibit tanaman", "tanaman hias"] },
  { id: 690, path: "Home & Garden > Lawn & Garden > Gardening > Composting > Compost", name: "Compost", kw: ["kompos", "compost"] },
  { id: 721, path: "Home & Garden > Lawn & Garden > Gardening > Pots & Planters", name: "Pots & Planters", kw: ["polybag", "pot tanaman", "pot bunga", "planter"] },
  { id: 1967, path: "Home & Garden > Lawn & Garden > Gardening > Gardening Tools > Lawn & Garden Sprayers", name: "Lawn & Garden Sprayers", kw: ["sprayer", "semprotan hama"] },
];

// Whole-word matcher: no letter/digit may touch either side, so "rok" ≠ "rokok" but "Rok Plisket" hits.
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRe = (kw: string) => new RegExp(`(?<![\\p{L}\\p{N}])${esc(kw)}(?![\\p{L}\\p{N}])`, "u");
const RULE_RES = RULES.flatMap((rule) => rule.kw.map((kw) => ({ rule, kw, re: wordRe(kw) })));

/** Suggest a Google category from product text, screened in order (title, merchant category,
 *  description): the first text with a hit wins, longest keyword within it. Returns null when nothing
 *  matches (honest — better a blank than a wrong feed category). */
export function suggestGoogleCategory(...texts: Array<string | null | undefined>): TaxonomySuggestion | null {
  for (const text of texts) {
    const hay = text?.toLowerCase();
    if (!hay) continue;
    let best: { rule: Rule; kwLen: number } | null = null;
    for (const { rule, kw, re } of RULE_RES) {
      if ((!best || kw.length > best.kwLen) && re.test(hay)) best = { rule, kwLen: kw.length };
    }
    if (best) return { id: best.rule.id, path: best.rule.path, name: best.rule.name };
  }
  return null;
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
  for (const kw of FEMALE_KW) if ((!g || kw.length > g.len) && wordRe(kw).test(hay)) g = { v: "female", len: kw.length };
  for (const kw of MALE_KW) if ((!g || kw.length > g.len) && wordRe(kw).test(hay)) g = { v: "male", len: kw.length };
  return g?.v ?? null;
}

// --- feed enum guards ---------------------------------------------------------------------------------
// `gender`/`age_group` are closed Google enums; anything else ("women" was found on live rows) makes the
// platform reject the attribute. Normalise the obvious aliases, drop the rest — on write AND on feed read.
const GENDER_ALIAS: Record<string, "female" | "male" | "unisex"> = {
  female: "female", women: "female", woman: "female", wanita: "female",
  male: "male", men: "male", man: "male", pria: "male",
  unisex: "unisex",
};
const AGE_GROUPS = new Set(["newborn", "infant", "toddler", "kids", "adult"]);

export const feedGender = (v: string | null | undefined) => GENDER_ALIAS[v?.trim().toLowerCase() ?? ""] ?? null;
export const feedAgeGroup = (v: string | null | undefined) => {
  const a = v?.trim().toLowerCase() ?? "";
  return AGE_GROUPS.has(a) ? a : null;
};
