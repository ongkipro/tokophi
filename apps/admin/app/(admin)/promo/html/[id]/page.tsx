import { notFound } from "next/navigation";
import { isUuid } from "@/lib/uuid";
import { getLandingEditor } from "@/lib/data/landing";
import { LandingEditorClient } from "./landing-editor-client";

export const dynamic = "force-dynamic";

export default async function LandingEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // A non-UUID segment reaches `eq(x.id, id)` and Postgres THROWS 22P02 — a 500 where a 404 belongs.
  // `/produk/…` takes the catalog NUMBER, so merchants do try `/<this route>/1042`. See lib/uuid.ts.
  if (!isUuid(id)) notFound();
  const editor = await getLandingEditor(id);
  if (!editor) notFound();
  return <LandingEditorClient editor={editor} />;
}
