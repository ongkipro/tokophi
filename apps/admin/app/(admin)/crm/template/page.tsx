import { getWaTemplates } from "@/lib/data/crm";
import { TemplateClient } from "./template-client";

export const dynamic = "force-dynamic";

export default async function TemplatePage() {
  const templates = await getWaTemplates();
  return <TemplateClient templates={templates} />;
}
