import { notFound } from "next/navigation";
import { getPromoEditor } from "@/lib/data/promo";
import { PromoEditorClient } from "./promo-editor-client";

export const dynamic = "force-dynamic";

export default async function PromoEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const editor = await getPromoEditor(id);
  if (!editor) notFound();
  return <PromoEditorClient editor={editor} />;
}
