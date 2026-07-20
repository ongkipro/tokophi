// Social handles — the ONE place a pasted profile link becomes a stored username.
//
// `stores.social_*` holds the USERNAME ONLY (no `@`, no URL): the storefront builds the link, so a
// stored value can never point at someone else's profile or carry a scheme. That decision moves the
// whole problem here: a merchant WILL paste `https://instagram.com/tokosaya` or
// `www.tiktok.com/@tokosaya` into a field labelled "username", and refusing that paste is a support
// ticket. Extracting from it costs a few lines.
//
// ⚠️ WHAT THIS DELIBERATELY DOES NOT DO: validate the character set of a handle. See the
// "over-validation is a bug" section in AGENTS.md — the rule that refuses a legitimate handle costs
// the merchant a whole channel and nobody ever finds out, because the merchant just sees an error and
// gives up. The platforms genuinely disagree with each other (Facebook allows dots, TikTok allows dots
// AND underscores, Instagram allows both, X allows underscores only, lengths differ, and every one of
// them has grandfathered accounts that break its own current rules). There is no universal pattern and
// inventing one would be a guess enforced as law. We normalise, cap the length, and store what is left.

import { normalizePhone } from "@tokophi/lib/validate";

export const SOCIAL_PLATFORMS = ["instagram", "tiktok", "facebook", "pinterest", "x"] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

/** What the merchant sees next to the input, so it is obvious the field wants a username. */
export const SOCIAL_META: Record<SocialPlatform, { label: string; prefix: string; placeholder: string }> = {
  instagram: { label: "Instagram", prefix: "instagram.com/", placeholder: "tokosaya" },
  tiktok: { label: "TikTok", prefix: "tiktok.com/@", placeholder: "tokosaya" },
  facebook: { label: "Facebook", prefix: "facebook.com/", placeholder: "toko.saya" },
  pinterest: { label: "Pinterest", prefix: "pinterest.com/", placeholder: "tokosaya" },
  x: { label: "X", prefix: "x.com/", placeholder: "tokosaya" },
};

/** A hard ceiling, not a format rule. The longest handle any of these platforms issues is well under
 *  this; it exists so a paste of an entire article cannot land in a text column. */
const MAX_LEN = 100;

/**
 * Turn whatever the merchant typed or pasted into a bare username.
 *
 * Accepts: `tokosaya`, `@tokosaya`, `instagram.com/tokosaya`, `https://www.tiktok.com/@tokosaya?lang=id`,
 * `https://id.pinterest.com/tokosaya/`, `https://facebook.com/profile.php?id=100064…`, `twitter.com/tokosaya`.
 * Returns `null` for empty — clearing a handle is a valid action (the storefront then shows no icon,
 * which is honest; a link to a dead profile is not).
 */
export function extractUsername(platform: SocialPlatform, raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  // Zero-width characters ride along on copy-paste from every one of these apps and are invisible in
  // the input — a handle that "looks identical" but 404s is the worst possible failure here.
  let s = raw.replace(/[\u200B-\u200D\uFEFF\u2060]/g, "").trim();
  if (!s) return null;

  // URL-shaped ONLY when there is a path separator or a scheme. Do NOT sniff for "looks like a
  // domain": `toko.saya` is a perfectly ordinary Facebook handle and `/^[\w.-]+\.[a-z]{2,}$/` matches
  // it. That test would silently eat a real merchant's page.
  if (s.includes("/") || /^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    s = extractFromUrlish(platform, s) ?? s;
  }

  // A leading `@` is how humans write a handle everywhere; the column stores it without.
  s = s.replace(/^@+/, "").trim();
  // Trailing slash / punctuation left by a sloppy paste.
  s = s.replace(/[\s/]+$/, "");
  if (!s) return null;
  return s.slice(0, MAX_LEN);
}

function extractFromUrlish(platform: SocialPlatform, input: string): string | null {
  let t = input.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ""); // drop scheme
  t = t.split("#")[0]; // fragment carries nothing
  const q = t.indexOf("?");
  const query = q >= 0 ? t.slice(q + 1) : "";
  if (q >= 0) t = t.slice(0, q);

  let parts = t.split("/").filter(Boolean);
  if (!parts.length) return null;

  // Drop the host. Only when there is something after it — otherwise a bare `toko.saya/` (a dotted
  // Facebook handle with a trailing slash) would be mistaken for a domain and thrown away.
  if (parts.length >= 2 && !parts[0].startsWith("@") && /\.[a-z]{2,}$/i.test(parts[0])) parts = parts.slice(1);
  if (!parts.length) return null;

  // Facebook's two link shapes that are NOT `/username`. Both resolve fine as `facebook.com/<id>`, so
  // keeping the numeric id is a real link, not a fallback.
  if (platform === "facebook") {
    if (parts[0].toLowerCase() === "profile.php") {
      const id = new URLSearchParams(query).get("id");
      if (id && /^\d+$/.test(id)) return id;
    }
    // facebook.com/people/Nama-Toko/100064…
    if (parts[0].toLowerCase() === "people" && parts[2] && /^\d+$/.test(parts[2])) return parts[2];
  }

  // TikTok puts the handle at `/@name`, but a shared link can be `/@name/video/123`. Prefer whichever
  // segment actually carries the `@` before falling back to the first one.
  const at = parts.find((p) => p.startsWith("@"));
  return at ?? parts[0];
}

// ── Public phone ────────────────────────────────────────────────────────────────────────────────
//
// ⚠️ This is NOT `normalizePhone` from @tokophi/lib/validate, and that is deliberate. That helper
// returns null for anything not starting `8` after the country code — correct there, because it
// guards WhatsApp numbers and a landline cannot receive WhatsApp. This field is the opposite case:
// `stores.whatsapp` already exists separately precisely BECAUSE plenty of shops publish a landline
// they do not run WhatsApp on. Running the public phone through `normalizePhone` would refuse
// `021-5551234` — a real, working shop number — and the merchant would have no way to publish it.
//
// So: canonicalise where the shared rule genuinely fits (a mobile → `62…`, same shape as
// `stores.whatsapp` and the rest of the app), and otherwise keep what the merchant typed. NEVER a
// carrier-prefix list, in either branch — see AGENTS.md.

/** Returns the value to store, or `null` when cleared. `"invalid"` = it contains no digits at all. */
export function normalizePublicPhone(raw: unknown): string | null | "invalid" {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/\s+/g, " ").trim();
  if (!s) return null; // cleared → NULL → the storefront shows no phone (honest)
  const mobile = normalizePhone(s);
  if (mobile) return mobile; // an Indonesian mobile → canonical 62…
  // Not a mobile. A landline (`021-5551234`), a short code (`1500123`) or an international number all
  // land here and are all legitimate. The only thing we refuse is a value with no digits in it, which
  // cannot be a phone number under any dialling plan.
  if (!/\d/.test(s)) return "invalid";
  return s.slice(0, 32);
}
