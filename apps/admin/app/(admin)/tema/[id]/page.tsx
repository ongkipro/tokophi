import type { Data } from "@measured/puck";
import { notFound } from "next/navigation";
import { DEFAULT_BRAND_COLOR } from "@tokophi/lib/colors";
import { getSession } from "@/lib/auth";
import { getBrandColor, getTemplate, TEMPLATE_TYPE_LABELS, type TemplateType } from "@/lib/data/theme";
import { BuilderClient } from "./builder-client";

export const dynamic = "force-dynamic";

const BLANK_DATA: Data = { content: [], root: {} };

// ADR 0009 — the drag-drop builder for ONE template (any type: homepage/category/product).
// The template list + assignment lives at /tema.
export default async function TemaBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const [template, brandColor] = await Promise.all([
    getTemplate(id),
    session ? getBrandColor(session.storeId) : Promise.resolve(null),
  ]);
  if (!template) notFound();

  return (
    <BuilderClient
      templateId={template.id}
      title={`${TEMPLATE_TYPE_LABELS[template.type as TemplateType]} — ${template.name}`}
      initialData={(template.sections as Data | undefined) ?? BLANK_DATA}
      initialBrandColor={brandColor ?? DEFAULT_BRAND_COLOR}
    />
  );
}
