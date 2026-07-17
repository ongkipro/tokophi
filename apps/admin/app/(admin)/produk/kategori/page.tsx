import { getCollections } from "@/lib/data/collections";
import { getStoreSlug } from "@/lib/data/store";
import { systemDomainFor } from "@/lib/data/domain";
import { getSession } from "@/lib/auth";
import { KategoriClient } from "./kategori-client";

export const dynamic = "force-dynamic";

export default async function KategoriPage() {
  const collections = await getCollections();
  // The store's always-on public storefront origin (<slug>.tokophi.id) for "Lihat di toko" links.
  const session = await getSession();
  const slug = session ? await getStoreSlug(session.storeId) : null;
  const storefrontBase = slug ? `https://${systemDomainFor(slug)}` : "";
  return <KategoriClient collections={collections} storefrontBase={storefrontBase} />;
}
