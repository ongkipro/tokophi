import { redirect } from "next/navigation";
import { getPlatformSession } from "@/lib/platform-auth";
import { PlatformShell } from "./platform-shell";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const session = await getPlatformSession();
  if (!session) redirect("/login"); // middleware normally handles this; defensive fallback
  return <PlatformShell admin={{ name: session.name, email: session.email }}>{children}</PlatformShell>;
}
