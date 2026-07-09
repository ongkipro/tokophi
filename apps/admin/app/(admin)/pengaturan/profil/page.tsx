import { getProfile } from "@/lib/actions/profile";
import { PageHeader } from "@/components/admin/page-header";
import { ProfilClient } from "./profil-client";

export const dynamic = "force-dynamic";

export default async function ProfilPage() {
  const profile = await getProfile();
  return (
    <div className="space-y-6">
      <PageHeader title="Profil" desc="Kelola informasi akun Anda." />
      {profile && <ProfilClient profile={profile} />}
    </div>
  );
}
