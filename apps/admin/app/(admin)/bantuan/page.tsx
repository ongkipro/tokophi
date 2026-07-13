import { getMyTickets } from "@/lib/data/support";
import { PageHeader } from "@/components/admin/page-header";
import { BantuanClient } from "./bantuan-client";

export const dynamic = "force-dynamic";

export default async function BantuanPage() {
  const tickets = await getMyTickets();
  return (
    <div className="space-y-6">
      <PageHeader title="Bantuan" desc="Hubungi tim TokoΦ — buat tiket dan pantau balasannya." />
      <BantuanClient tickets={tickets} />
    </div>
  );
}
