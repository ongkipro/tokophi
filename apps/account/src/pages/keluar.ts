import type { APIRoute } from "astro";
import { db } from "@tokophi/db";
import { revokeSession } from "../data/account";
import { ACCOUNT_COOKIE } from "../lib/session";

export const POST: APIRoute = async ({ locals, cookies, redirect }) => {
  if (locals.account && locals.sessionId) await revokeSession(db, locals.account.id, locals.sessionId);
  cookies.delete(ACCOUNT_COOKIE, { path: "/" });
  return redirect("/masuk", 303);
};
