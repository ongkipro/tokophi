import { getBulkShipping, type BulkFilters } from "@/lib/data/bulk-shipping";
import { MassalClient } from "./massal-client";

// Pengiriman Massal — the packing queue. Replaced the old "Perlu Dikirim" nav link, which was a
// saved link to ?tab=perlu_dikirim: the same view the list already had a tab for, and the same one
// the parent nav row now points at (it is what the badge counts). Three doors onto one room.
export const dynamic = "force-dynamic";

export default async function PengirimanMassalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const filters: BulkFilters = {
    group: sp.group,
    courier: sp.kurir,
    printed: sp.cetak === "yes" || sp.cetak === "no" ? sp.cetak : undefined,
    resi: sp.resi === "yes" || sp.resi === "no" ? sp.resi : undefined,
    bundle: sp.isi === "yes" || sp.isi === "no" ? sp.isi : undefined,
  };
  const data = await getBulkShipping(filters);
  return <MassalClient data={data} filters={filters} />;
}
