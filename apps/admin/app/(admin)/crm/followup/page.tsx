import { getFollowups, getWaTemplates } from "@/lib/data/crm";
import { FollowupClient } from "./followup-client";

export const dynamic = "force-dynamic";

export default async function FollowupPage() {
  const [followups, templates] = await Promise.all([getFollowups(), getWaTemplates()]);
  return <FollowupClient followups={followups} templates={templates} />;
}
