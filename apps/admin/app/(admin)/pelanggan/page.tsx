import { getCustomers } from "@/lib/data/customers";
import { PelangganClient } from "./pelanggan-client";

export const dynamic = "force-dynamic";

export default async function PelangganPage() {
  const customers = await getCustomers();
  return <PelangganClient customers={customers} />;
}
