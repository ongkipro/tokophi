import type { APIRoute } from "astro";
import { db } from "@tokophi/db";
import { OAUTH_STATE_COOKIE, exchangeCode, googleConfig, stateMatches } from "@tokophi/lib/google-oauth";
import { upsertAccountBySub } from "../../../data/account";
import { safeNext } from "../../../lib/nav";
import { startSession } from "../../../lib/signin";

export const GET: APIRoute = async ({ url, cookies, request, redirect }) => {
  const cfg = googleConfig("ACCOUNT_GOOGLE_REDIRECT_URI");
  if (!cfg) return redirect("/masuk", 302);
  const cookieState = cookies.get(OAUTH_STATE_COOKIE)?.value;
  const next = safeNext(cookies.get("acc_next")?.value);
  cookies.delete(OAUTH_STATE_COOKIE, { path: "/" });
  cookies.delete("acc_next", { path: "/" });
  if (url.searchParams.get("error")) return redirect("/masuk?e=google_batal", 302);
  const code = url.searchParams.get("code");
  if (!code || !stateMatches(url.searchParams.get("state"), cookieState)) return redirect("/masuk?e=google_state", 302);
  const profile = await exchangeCode(cfg, code);
  if (!profile || !profile.emailVerified) return redirect("/masuk?e=google_gagal", 302);
  const id = await upsertAccountBySub(db, { sub: profile.sub, email: profile.email, name: profile.name || null });
  if (!id) return redirect("/masuk?e=akun", 302);
  await startSession(cookies, id, request.headers.get("user-agent"));
  return redirect(next, 302);
};
