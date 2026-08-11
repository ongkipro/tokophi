import type { Data } from "@measured/puck";
import { notFound } from "next/navigation";
import { DEFAULT_BRAND_COLOR } from "@tokophi/lib/colors";
import { getSession } from "@/lib/auth";
import {
  getBrandColor,
  getPlatformDefaultSections,
  getTemplate,
  TEMPLATE_TYPE_LABELS,
  type TemplateType,
} from "@/lib/data/theme";
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

  // A template the merchant has never filled starts from the PLATFORM DEFAULT's sections, not a
  // blank canvas — they swap the banner and the copy instead of building a page from nothing.
  // Prefill only (T-9 decision B, copy-on-FIRST-EDIT): the merchant's own row is written when they
  // press Publish, through the ordinary saveTemplate path. A template with any content of its own is
  // never touched — this branch is dead the moment they have saved anything.
  const own = template.sections as Data | undefined;
  const hasOwnContent = Array.isArray(own?.content) && own.content.length > 0;
  const initialData = hasOwnContent
    ? (own as Data)
    : (((await getPlatformDefaultSections(template.type as TemplateType)) as Data | null) ?? BLANK_DATA);

  return (
    <BuilderClient
      templateId={template.id}
      // The builder needs to know WHICH page it is editing: the three template types render in three
      // different places (the whole homepage / the body under a category's header / the PDP tail), so
      // they do not offer the same sections. Without this the palette was identical for all three.
      templateType={template.type as TemplateType}
      title={`${TEMPLATE_TYPE_LABELS[template.type as TemplateType]} — ${template.name}`}
      initialData={initialData}
      initialBrandColor={brandColor ?? DEFAULT_BRAND_COLOR}
    />
  );
}
