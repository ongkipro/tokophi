import { getProfile } from "@/lib/actions/profile";
import { ProfilClient } from "./profil-client";

export const dynamic = "force-dynamic";

export default async function ProfilPage() {
  const profile = await getProfile();
  return profile ? <ProfilClient profile={profile} /> : null;
}
