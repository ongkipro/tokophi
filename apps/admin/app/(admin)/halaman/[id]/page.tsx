import { notFound } from "next/navigation";
import { getPage } from "@/lib/data/pages";
import { PageEditor } from "./page-editor";

export const dynamic = "force-dynamic";

export default async function EditHalamanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const page = await getPage(id);
  if (!page) notFound();
  return <PageEditor page={page} />;
}
