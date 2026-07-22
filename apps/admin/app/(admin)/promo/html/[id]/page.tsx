import { notFound } from "next/navigation";
import { getLandingEditor } from "@/lib/data/landing";
import { LandingEditorClient } from "./landing-editor-client";

export const dynamic = "force-dynamic";

export default async function LandingEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const editor = await getLandingEditor(id);
  if (!editor) notFound();
  return <LandingEditorClient editor={editor} />;
}
