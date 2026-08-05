import { redirect } from "next/navigation";
import { getPlatformSession } from "@/lib/platform-auth";
import { getOpenTicketCount } from "@/lib/data";
import { PlatformShell } from "./platform-shell";

// Support load belongs in the operator's line of sight, not one click away. `getOpenTicketCount()`
// already existed and was called from nowhere.
export const dynamic = "force-dynamic";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const session = await getPlatformSession();
  // ⚠️ NO SESSION HERE MEANS THE OPERATOR ROW IS GONE OR THEIR PASSWORD WAS ROTATED, not that the
  // cookie is missing — `middleware.ts` already turned away anyone without a valid JWT, and it runs
  // on the edge where it cannot ask the database. `getPlatformSession` re-reads `platform_admins` on
  // every request, so a deleted operator still holds a perfectly valid token and lands HERE.
  // …to the sign-out ROUTE, not straight to /login: middleware sees the still-valid JWT and bounces
  // /login back to /, and the two ping-pong (ERR_TOO_MANY_REDIRECTS — measured on this branch). The
  // cookie has to actually go, and only a route handler can delete one.
  if (!session) redirect("/api/auth/signout");
  const openTickets = await getOpenTicketCount();
  return (
    <PlatformShell admin={{ name: session.name, email: session.email }} openTickets={openTickets}>
      {children}
    </PlatformShell>
  );
}
