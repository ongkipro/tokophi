import { getPages } from "@/lib/data/pages";
import { HalamanClient } from "./halaman-client";

export const dynamic = "force-dynamic";

export default async function HalamanPage() {
  const pages = await getPages();
  return <HalamanClient pages={pages} />;
}
