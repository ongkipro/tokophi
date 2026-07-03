import { getAdChannels, getProvinceStats } from "@/lib/data/marketing";
import { PemasaranClient } from "./pemasaran-client";

export const dynamic = "force-dynamic";

export default async function PemasaranPage() {
  const [channels, provinces] = await Promise.all([getAdChannels(), getProvinceStats()]);
  return <PemasaranClient channels={channels} provinces={provinces} />;
}
