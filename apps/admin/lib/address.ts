// Compose an Indonesian address line out of its parts — ONE definition, used by both the seller's
// pickup-address card (what the merchant reads back) and createShipment (what the courier is sent).
// Two copies would drift, and the day they drift is the day the screen stops describing the parcel.
//
// Why de-duplication is not cosmetic: Indonesian addresses repeat their own components constantly.
// The seeded warehouse is a fair example — street "Jl. Raya Gubeng No. 42, Gubeng", kelurahan
// "Gubeng", kecamatan "Gubeng, Surabaya, Jawa Timur" — which naively concatenates to
//
//     Jl. Raya Gubeng No. 42, Gubeng, Gubeng, Gubeng, Surabaya, Jawa Timur
//
// A courier's address parser (and a human driver) reads that as noise, and it is the string we hand
// to `request_pickup`. So parts are split on commas, compared case-insensitively, and each distinct
// component is kept exactly once, in order. "Jl. Raya Gubeng" survives — it is not the token
// "Gubeng" — because comparison is on whole comma-separated components, never on substrings.
export function composeAddress(parts: (string | null | undefined)[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    if (!part) continue;
    for (const raw of String(part).split(",")) {
      const piece = raw.trim().replace(/\s+/g, " ");
      if (!piece) continue;
      const key = piece.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(piece);
    }
  }
  return out.join(", ");
}
