// Origin of the TokoΦ Account app (apps/account) — where a seller's affiliate invitation points.
// Unset ⇒ the "Undang ke akun" action is hidden and refused. No trailing slash.
export function accountAppUrl(env: Record<string, string | undefined> = process.env): string | null {
  const v = env.ACCOUNT_APP_URL?.trim().replace(/\/+$/, "");
  return v && /^https?:\/\/[^/\s]+$/.test(v) ? v : null;
}
