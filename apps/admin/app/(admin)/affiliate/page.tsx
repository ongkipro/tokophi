import { getAffiliateProgram } from "@/lib/data/affiliates";
import { AffiliateClient } from "./affiliate-client";

export const dynamic = "force-dynamic";

export default async function AffiliatePage() {
  return <AffiliateClient program={await getAffiliateProgram()} />;
}
