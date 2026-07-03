import { getReviews } from "@/lib/data/reviews";
import { UlasanClient } from "./ulasan-client";

export const dynamic = "force-dynamic";

export default async function UlasanPage() {
  const reviews = await getReviews();
  return <UlasanClient reviews={reviews} />;
}
