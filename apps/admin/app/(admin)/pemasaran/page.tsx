import { getAdChannels } from "@/lib/data/marketing";
import { getFeedStatus } from "@/lib/data/feed";
import { getTrackingConfig } from "@/lib/data/tracking";
import { PemasaranClient } from "./pemasaran-client";

export const dynamic = "force-dynamic";

export default async function PemasaranPage() {
  const [channels, feed, tracking] = await Promise.all([getAdChannels(), getFeedStatus(), getTrackingConfig()]);
  return <PemasaranClient channels={channels} feed={feed} tracking={tracking} />;
}
