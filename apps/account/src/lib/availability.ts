// Is Akun TokoΦ OPEN on this server? (ADR 0016 "Production enablement", BUYER-ACCOUNT-DEPLOY.)
// The container ships to account.tokophi.com before the owner finishes the Google OAuth client. A
// production build has exactly one sign-in method (Google; the email form is dev-only), so with no
// Google config there is no way in: every page then answers ONE honest "belum dibuka" page (503) —
// never a sign-in card that cannot sign anyone in, never a 500 — and touches no database row.
// Read at call time: the image is built without env; Coolify sets it on the container.
import { googleConfig } from "@tokophi/lib/google-oauth";
import { claimSecret } from "@tokophi/lib/claim-token";
import { devSignInAllowed } from "./dev-signin";

type Env = Record<string, string | undefined>;

/** The page every request is rewritten to while the account is closed. */
export const CLOSED_PAGE = "/belum-dibuka";
/** The container healthcheck — must answer while closed, or Traefik has no server for the host. */
export const HEALTH_PATH = "/healthz";

/** Some sign-in method works here: Google configured, or the local-development email form. */
export function signInAvailable(env: Env = process.env, prodBuild: boolean = import.meta.env?.PROD === true): boolean {
  return googleConfig("ACCOUNT_GOOGLE_REDIRECT_URI", env) !== null || devSignInAllowed(env, prodBuild);
}

/** Saving an order (`/klaim`) also needs the claim secret — the same predicate that issues tokens. */
export const claimAvailable = (env: Env = process.env): boolean => claimSecret(env) !== null;

/** Where the middleware rewrites `pathname` to, or null to serve it as asked. */
export function closedRewrite(pathname: string, env: Env = process.env, prodBuild: boolean = import.meta.env?.PROD === true): string | null {
  if (pathname === HEALTH_PATH || pathname === CLOSED_PAGE) return null;
  return signInAvailable(env, prodBuild) ? null : CLOSED_PAGE;
}
