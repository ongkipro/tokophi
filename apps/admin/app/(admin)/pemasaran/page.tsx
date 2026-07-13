import { getAdChannels } from "@/lib/data/marketing";
import { PemasaranClient } from "./pemasaran-client";

export const dynamic = "force-dynamic";

export default async function PemasaranPage() {
  const channels = await getAdChannels();
  return <PemasaranClient channels={channels} />;
}
