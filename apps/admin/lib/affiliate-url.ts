// Origin of the affiliate app (apps/affiliate, affiliate.tokophi.com, ADR 0022) — where a seller's
// invitation link points. The SAME variable is the affiliate app's own open/closed switch and the
// storefront's join link, so the three surfaces agree on whether the affiliate area exists.
// Unset or not a bare http(s) origin ⇒ the "Undang ke akun affiliate" action is hidden and refused.
// No trailing slash.
export function affiliateAppUrl(raw: string | undefined = process.env.AFFILIATE_APP_URL): string | null {
  const v = raw?.trim().replace(/\/+$/, "");
  return v && /^https?:\/\/[^/\s?#@]+$/.test(v) ? v : null;
}
