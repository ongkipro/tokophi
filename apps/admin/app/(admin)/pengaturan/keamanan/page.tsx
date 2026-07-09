import { getSecurity } from "@/lib/actions/security";
import { PageHeader } from "@/components/admin/page-header";
import { SecurityClient } from "./security-client";

export const dynamic = "force-dynamic";

export default async function KeamananPage() {
  const sec = await getSecurity();
  return (
    <div className="space-y-6">
      <PageHeader title="Keamanan" desc="Kata sandi dan autentikasi 2 langkah akun Anda." />
      {sec && <SecurityClient email={sec.email} twoFactor={sec.twoFactor} />}
    </div>
  );
}
