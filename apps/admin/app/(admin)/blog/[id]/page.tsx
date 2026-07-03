import { notFound } from "next/navigation";
import { getArticle } from "@/lib/data/articles";
import { ArticleEditor } from "./article-editor";

export const dynamic = "force-dynamic";

export default async function EditArticlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const post = await getArticle(id);
  if (!post) notFound();
  return <ArticleEditor post={post} />;
}
