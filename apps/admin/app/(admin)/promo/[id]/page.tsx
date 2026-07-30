import { notFound } from "next/navigation";
import { getPromoEditor } from "@/lib/data/promo";
import { PromoEditorClient } from "./promo-editor-client";

export const dynamic = "force-dynamic";

// ⚠️ This route is keyed on a product UUID, deliberately — it is reached from the promo list, not typed.
// But `/produk/…` now takes the catalog NUMBER, which teaches merchants that "a product is a number",
// so `/promo/1042` will be tried. Without this guard it reaches `eq(products.id, "1042")`, Postgres
// answers 22P02, and the render 500s instead of 404-ing. Same class as `produk/[id]`, one file over.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PromoEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const editor = await getPromoEditor(id);
  if (!editor) notFound();
  return <PromoEditorClient editor={editor} />;
}
