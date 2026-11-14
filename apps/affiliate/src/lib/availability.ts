// Is the affiliate area OPEN on this server? (ADR 0022 "Production enablement", like the account app's
// BUYER-ACCOUNT-DEPLOY switch.) The container ships to affiliate.tokophi.com before the owner turns the
// programme on. The switch is ONE variable, the same one the Seller panel (invite links) and the
// storefront (`/affiliate` → join link) read: `AFFILIATE_APP_URL`, this app's own public origin.
// Unset or not a usable origin ⇒ every page answers ONE honest "belum dibuka" page (503) and touches no
// database row; `/healthz` still answers so Traefik keeps a server for the host.
// Read at call time: the image is built without env; Coolify sets it on the container.

type Env = Record<string, string | undefined>;

/** The page every request is rewritten to while the area is closed. */
export const CLOSED_PAGE = "/belum-dibuka";
/** The container healthcheck — must answer while closed, or Traefik has no server for the host. */
export const HEALTH_PATH = "/healthz";

/**
 * `AFFILIATE_APP_URL` as a bare origin (`https://affiliate.tokophi.com`, trailing slash dropped), or null.
 * https only in a production build; plain http is accepted for local development.
 */
export function affiliateOrigin(env: Env = process.env, prodBuild: boolean = import.meta.env?.PROD === true): string | null {
  const raw = (env.AFFILIATE_APP_URL ?? "").trim().replace(/\/+$/, "");
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.origin !== raw) return null; // a path, query or credentials is not an origin
    if (u.protocol === "https:" || (u.protocol === "http:" && !prodBuild)) return u.origin;
  } catch {
    // not a URL
  }
  return null;
}

export const affiliateOpen = (env: Env = process.env, prodBuild: boolean = import.meta.env?.PROD === true): boolean =>
  affiliateOrigin(env, prodBuild) !== null;

/** Where the middleware rewrites `pathname` to, or null to serve it as asked. */
export function closedRewrite(pathname: string, env: Env = process.env, prodBuild: boolean = import.meta.env?.PROD === true): string | null {
  if (pathname === HEALTH_PATH || pathname === CLOSED_PAGE) return null;
  return affiliateOpen(env, prodBuild) ? null : CLOSED_PAGE;
}
