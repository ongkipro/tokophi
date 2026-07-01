import { PAGES } from "@/lib/mock/store";
import { notFound } from "next/navigation";
import { PageEditor } from "./page-editor";

export function generateStaticParams() {
  return PAGES.map((p) => ({ id: p.id }));
}

export default async function EditHalamanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const page = PAGES.find((p) => p.id === id);
  if (!page) notFound();
  return <PageEditor page={page} />;
}
