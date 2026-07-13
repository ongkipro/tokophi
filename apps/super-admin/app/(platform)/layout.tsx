import { redirect } from "next/navigation";
import { getPlatformSession } from "@/lib/platform-auth";
import { getOpenTicketCount } from "@/lib/data";
import { PlatformShell } from "./platform-shell";

// Support load belongs in the operator's line of sight, not one click away. `getOpenTicketCount()`
// already existed and was called from nowhere.
export const dynamic = "force-dynamic";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const session = await getPlatformSession();
  if (!session) redirect("/login"); // middleware normally handles this; defensive fallback
  const openTickets = await getOpenTicketCount();
  return (
    <PlatformShell admin={{ name: session.name, email: session.email }} openTickets={openTickets}>
      {children}
    </PlatformShell>
  );
}
