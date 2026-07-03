import { getStores } from "@/lib/data";
import { TokoClient } from "./toko-client";

export const dynamic = "force-dynamic";

export default async function TokoPage() {
  const stores = await getStores();
  return <TokoClient stores={stores} />;
}
