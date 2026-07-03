import { getCollections } from "@/lib/data/collections";
import { KategoriClient } from "./kategori-client";

export const dynamic = "force-dynamic";

export default async function KategoriPage() {
  const collections = await getCollections();
  return <KategoriClient collections={collections} />;
}
