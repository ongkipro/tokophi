import type { AstroCookies } from "astro";
import { db } from "@tokophi/db";
import { createSession, revokeSession } from "../data/account";
import { ACCOUNT_COOKIE, accountCookieOptions, signAccountSession } from "./session";

/** Start a session for a verified account and set the host-only cookie. Signing in again over a live
 *  session revokes that one first, so it never lingers 30 days as a phantom "other device". */
export async function startSession(
  cookies: AstroCookies,
  locals: App.Locals,
  accountId: string,
  userAgent: string | null,
): Promise<void> {
  if (locals.account && locals.sessionId) await revokeSession(db, locals.account.id, locals.sessionId);
  const sid = await createSession(db, accountId, userAgent);
  cookies.set(ACCOUNT_COOKIE, await signAccountSession(sid), accountCookieOptions());
}
