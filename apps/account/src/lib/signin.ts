import type { AstroCookies } from "astro";
import { db } from "@tokophi/db";
import { createSession } from "../data/account";
import { ACCOUNT_COOKIE, accountCookieOptions, signAccountSession } from "./session";

/** Start a session for a verified account and set the host-only cookie. */
export async function startSession(cookies: AstroCookies, accountId: string, userAgent: string | null): Promise<void> {
  const sid = await createSession(db, accountId, userAgent);
  cookies.set(ACCOUNT_COOKIE, await signAccountSession(sid), accountCookieOptions());
}
