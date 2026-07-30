/**
 * Which ad channel produced this order — LAST AD CLICK, from the click ids the shopper's browser
 * already carries.
 *
 * ⚠️ `orders.channel` was hard-coded to `"organic"` here, and this is its ONLY writer in the product.
 * So every real store's Pemasaran screen read "0 pesanan / Rp0 dari saluran iklan" forever — including
 * a store whose Meta pixel was live and converting — while the seeded demo store showed a channel split
 * a random number generator had written. A merchant sizing an ad budget against either one is being
 * misled; the demo's flattering numbers were the same defect wearing a nicer face.
 *
 * What we can honestly claim:
 *   • `_fbc`    — Meta writes it only when `fbclid` was in the URL, i.e. on an ad click. Format
 *                 `fb.1.<ms>.<fbclid>`, so it carries the click's own timestamp.
 *   • `_gcl_aw` — gtag writes it on a Google Ads click. Format `GCL.<seconds>.<gclid>`.
 *   • `ttclid`  — captured from the URL by MarketingPixels on the landing page. No timestamp, so it
 *                 only wins when neither of the timestamped two is present.
 * `_fbp` and `_ttp` are deliberately NOT used: they are set on ANY visit, ad or not, and treating them
 * as attribution would relabel most organic traffic as paid.
 *
 * This is last-click attribution from the buyer's own browser, not a platform's attribution model — it
 * will not match Meta Ads Manager, and it is not meant to. It answers "which ad brought this order",
 * which is the question the screen asks. Unlike a price, nothing here is money: a spoofed cookie
 * mislabels one order's channel and can charge nothing.
 */
export function adChannel(c?: { fbc?: string; gcl?: string; ttclid?: string }): "meta_ads" | "google_ads" | "tiktok_ads" | "organic" {
  const fb = /^fb\.\d+\.(\d{10,})\./.exec(String(c?.fbc ?? ""));
  const gc = /^GCL\.(\d{9,})\./.exec(String(c?.gcl ?? ""));
  // `_fbc` is milliseconds, `_gcl_aw` is seconds — compare in the same unit or Google always loses.
  const fbAt = fb ? Number(fb[1]) : 0;
  const gcAt = gc ? Number(gc[1]) * 1000 : 0;
  if (fbAt || gcAt) return fbAt >= gcAt ? "meta_ads" : "google_ads";
  return String(c?.ttclid ?? "").trim() ? "tiktok_ads" : "organic";
}
