import { getLeads, getWaTemplates } from "@/lib/data/crm";
import { PipelineClient } from "./pipeline-client";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const [leads, templates] = await Promise.all([getLeads(), getWaTemplates()]);
  return <PipelineClient leads={leads} templates={templates} />;
}
