import { notFound } from "next/navigation";
import { getArticle, getBlogs } from "@/lib/data/articles";
import { ArticleEditor } from "./article-editor";

export const dynamic = "force-dynamic";

export default async function EditArticlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [post, blogs] = await Promise.all([getArticle(id), getBlogs()]);
  if (!post) notFound();
  return <ArticleEditor post={post} blogs={blogs} />;
}
