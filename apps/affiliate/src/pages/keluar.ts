// Sign out: revoke THIS session row, then drop the cookie. POST only (a GET link could be fired by any page).
import type { APIRoute } from "astro";
import { db } from "@tokophi/db";
import { revokeSession } from "../data/auth";
import { AFFILIATE_COOKIE } from "../lib/session";

export const POST: APIRoute = async ({ locals, cookies, redirect }) => {
  if (locals.account && locals.sessionId) await revokeSession(db, locals.account.id, locals.sessionId);
  cookies.delete(AFFILIATE_COOKIE, { path: "/" });
  return redirect("/masuk", 303);
};
