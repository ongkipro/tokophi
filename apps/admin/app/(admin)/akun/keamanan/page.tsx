import { getSecurity } from "@/lib/actions/security";
import { SecurityClient } from "./security-client";

export const dynamic = "force-dynamic";

export default async function KeamananPage() {
  const sec = await getSecurity();
  return sec ? <SecurityClient email={sec.email} twoFactor={sec.twoFactor} /> : null;
}
