// `/affiliate` → "Daftar jadi affiliate" (ADR 0022). Affiliates have their OWN accounts at the platform's
// affiliate origin (apps/affiliate); applying to THIS store is its `/gabung?toko=<slug>` page — a path that
// is a contract between the two apps. RUNTIME env (process.env), like `account-link.ts`: the Docker image is
// built without env. Unset or not a bare origin ⇒ null ⇒ the page says the programme cannot take
// applications yet (no public form: an anonymous form is what the 2026-10-29 audit found enumerable).
// https only in a production build; plain http for local development.
export function affiliateJoinUrl(
  slug: string,
  raw: string | undefined = process.env.AFFILIATE_APP_URL,
  prodBuild: boolean = import.meta.env.PROD === true,
): string | null {
  try {
    const trimmed = (raw ?? "").trim().replace(/\/+$/, "");
    const u = new URL(trimmed);
    if (u.origin !== trimmed) return null; // a path, query or credentials is not an origin
    if (u.protocol === "https:" || (u.protocol === "http:" && !prodBuild)) return `${u.origin}/gabung?toko=${encodeURIComponent(slug)}`;
  } catch {
    // unset or not a URL
  }
  return null;
}
