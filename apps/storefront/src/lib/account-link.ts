// "Simpan ke Akun TokoΦ" on /checkout/sukses (ADR 0016, BUYER-ACCOUNT-P1). The target is the platform's
// account origin (apps/account), its `/klaim` page — a path that is a contract between the two apps.
// RUNTIME env (process.env), for the same reason as `public-api.ts`: the Docker image is built without
// env. Unset or not a URL ⇒ null ⇒ the offer is not rendered at all and the success page is unchanged.
// The link will carry a claim token, so only https qualifies — plain http only outside a production build.
export function accountClaimUrl(raw: string | undefined = process.env.ACCOUNT_APP_URL, prodBuild: boolean = import.meta.env.PROD === true): string | null {
  try {
    const u = new URL((raw ?? "").trim());
    if (u.username || u.password) return null;
    if (u.protocol === "https:" || (u.protocol === "http:" && !prodBuild)) return `${u.origin}/klaim`;
  } catch {
    // unset or not a URL
  }
  return null;
}
