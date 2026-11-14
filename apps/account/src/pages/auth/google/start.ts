// Google sign-in for the account app (ACC-10) — the SAME flow as Seller (`@tokophi/lib/google-oauth`,
// Task 10.12), its own redirect URI (`ACCOUNT_GOOGLE_REDIRECT_URI`, owner adds it to the existing
// client — OD-7). Unset ⇒ the button is not shown and this route bounces to /masuk.
import type { APIRoute } from "astro";
import { OAUTH_STATE_COOKIE, authorizeUrl, googleConfig, newOAuthState } from "@tokophi/lib/google-oauth";
import { SECURE_COOKIES } from "@tokophi/lib/session-cookie";
import { safeNext } from "../../../lib/nav";

export const GET: APIRoute = ({ url, cookies, redirect }) => {
  const cfg = googleConfig("ACCOUNT_GOOGLE_REDIRECT_URI");
  if (!cfg) return redirect("/masuk", 302);
  const state = newOAuthState("acc");
  const opts = { httpOnly: true, sameSite: "lax" as const, path: "/", maxAge: 600, secure: SECURE_COOKIES };
  cookies.set(OAUTH_STATE_COOKIE, state, opts);
  cookies.set("acc_next", safeNext(url.searchParams.get("next")), opts);
  return redirect(authorizeUrl(cfg, state), 302);
};
