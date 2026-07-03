import { getSegments } from "@/lib/data/segments";
import { SegmenClient } from "./segmen-client";

export const dynamic = "force-dynamic";

export default async function SegmenPage() {
  const segments = await getSegments();
  return <SegmenClient segments={segments} />;
}
