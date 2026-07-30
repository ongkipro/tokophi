/**
 * Which ad channel produced this order — from the shopper's own browser, at order creation.
 *
 * ⚠️ `orders.channel` was hard-coded to `"organic"` by its only writer until 2026-07-30. So every real
 * store's Pemasaran screen read "0 pesanan / Rp0 dari saluran iklan" forever — including a store whose
 * Meta pixel was live and converting — while the seeded demo store showed a split a random number
 * generator had written.
 *
 * ⚠️⚠️ AND THE FIRST FIX WAS WRONG, in the way that matters most: it treated `_fbc` as proof of an ad
 * click. **It is not.** Meta appends `fbclid` to EVERY outbound Facebook/Instagram/Messenger link —
 * organic posts, comments, shares, a bio link — not only ads. Google's `gclid` and TikTok's `ttclid`
 * really are paid-only; `fbclid` is not. Left as it was, a shopper tapping the merchant's own Instagram
 * bio link would have been booked as Meta Ads revenue, and because `_fbc` carries a timestamp it would
 * also have beaten a genuine Google Ads click in the tie-break. That is a new misleading number wearing
 * the costume of a fixed one.
 *
 * So the signal order is:
 *   1. **UTM, captured on the landing page.** `utm_medium` is the only thing that actually distinguishes
 *      paid from organic for Meta, and it is what the merchant controls. `cpc` / `ppc` / `paid*` on a
 *      recognised source wins outright.
 *   2. **Paid-only click ids**: `gclid`/`gbraid`/`gs` (Google, incl. the iOS fallbacks) and `ttclid`
 *      (TikTok). Safe on their own.
 *   3. **`_fbc` alone → `other`, never `meta_ads`.** It says "arrived from Meta", not "arrived from a
 *      Meta ad". `other` is the honest bucket for that, and a merchant who tags their ad URLs with
 *      `utm_medium=cpc` — which Meta's own URL-parameters field exists to do — gets `meta_ads` properly.
 * `_fbp` and `_ttp` are used for NOTHING here: they are set on any visit at all.
 *
 * Last-click, first-party, ours. It will not match Meta Ads Manager (view-throughs, cross-device, a
 * different window) and does not claim to. Unlike a price, nothing here is money: a spoofed cookie
 * mislabels one order's channel and can charge nothing.
 *
 * ⚠️ AND IT IS WINDOWED. `_fbc` and `_gcl_aw` both live 90 days, so without a window a single click in
 * May would relabel every organic order that shopper places until August — attribution drifts upward and
 * never comes back. 30 days is Google's own default conversion window and two days past TikTok's, and it
 * is longer than Meta's 7-day click window, so it is generous to the platforms rather than to us.
 */
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** `utm_medium` values that mean "somebody paid for this click". */
const PAID_MEDIUM = /^(cpc|ppc|paid|paidsocial|paid_social|paid-social|cpm|cpv|display|social_paid)$/i;

type Channel = "meta_ads" | "google_ads" | "tiktok_ads" | "organic" | "other";

function sourceChannel(src: string): Channel | null {
  const s = src.trim().toLowerCase();
  if (/^(facebook|fb|instagram|ig|meta)/.test(s)) return "meta_ads";
  if (/^(google|adwords|googleads|youtube)/.test(s)) return "google_ads";
  if (/^tiktok/.test(s)) return "tiktok_ads";
  return null;
}

export function adChannel(
  c?: { fbc?: string; gcl?: string; ttclid?: string; utmSource?: string; utmMedium?: string },
  now: number = Date.now(),
): Channel {
  // 1. The merchant's own tagging beats every cookie — it is the one signal that knows "paid".
  if (PAID_MEDIUM.test(String(c?.utmMedium ?? "").trim())) {
    const bySource = sourceChannel(String(c?.utmSource ?? ""));
    if (bySource) return bySource;
    return "other"; // paid, but not one of our three networks
  }

  // 2. Paid-only click ids. `_fbc` is deliberately NOT here.
  const gc = /^GCL\.(\d{9,})\./.exec(String(c?.gcl ?? ""));
  const gcAt = gc ? Number(gc[1]) * 1000 : 0;
  if (gcAt > 0 && now - gcAt <= WINDOW_MS) return "google_ads";
  // Google's iOS fallbacks (`_gcl_gb` = gbraid, `_gcl_gs` = gs) carry no parseable timestamp in the same
  // shape, so presence is the signal; the storefront only forwards a fresh one.
  if (String(c?.gcl ?? "").startsWith("GB.") || String(c?.gcl ?? "").startsWith("GS.")) return "google_ads";
  // TikTok's click id has no timestamp, but the storefront already refuses to send one older than
  // TikTok's own 28-day window (checkout.astro), so the window is enforced before it reaches us.
  if (String(c?.ttclid ?? "").trim()) return "tiktok_ads";

  // 3. Came from Meta, but we cannot tell whether it was paid. Say so.
  const fb = /^fb\.\d+\.(\d{10,})\./.exec(String(c?.fbc ?? ""));
  const fbAt = fb ? Number(fb[1]) : 0;
  if (fbAt > 0 && now - fbAt <= WINDOW_MS) return "other";

  return "organic";
}
