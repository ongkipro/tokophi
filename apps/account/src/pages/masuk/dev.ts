// LOCAL DEVELOPMENT sign-in (no password). Refused outright in a production build — not hidden.
import type { APIRoute } from "astro";
import { db } from "@tokophi/db";
import { upsertAccountBySub } from "../../data/account";
import { devSignInAllowed, devSubject } from "../../lib/dev-signin";
import { safeNext } from "../../lib/nav";
import { startSession } from "../../lib/signin";

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  if (!devSignInAllowed()) return new Response("Not found", { status: 404 });
  const form = await request.formData();
  const next = safeNext(String(form.get("next") ?? ""));
  const sub = devSubject(form.get("email"));
  if (!sub) return redirect(`/masuk?e=dev_email&next=${encodeURIComponent(next)}`, 303);
  const email = sub.slice(4);
  const id = await upsertAccountBySub(db, { sub, email, name: email.split("@")[0] });
  if (!id) return redirect("/masuk?e=akun", 303);
  await startSession(cookies, id, request.headers.get("user-agent"));
  return redirect(next, 303);
};
