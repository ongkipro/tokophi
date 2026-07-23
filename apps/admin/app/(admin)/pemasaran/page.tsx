import { getAdChannels } from "@/lib/data/marketing";
import { getFeedStatus } from "@/lib/data/feed";
import { PemasaranClient } from "./pemasaran-client";

export const dynamic = "force-dynamic";

export default async function PemasaranPage() {
  const [channels, feed] = await Promise.all([getAdChannels(), getFeedStatus()]);
  return <PemasaranClient channels={channels} feed={feed} />;
}
