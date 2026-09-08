import { notFound } from "next/navigation";
import { isUuid } from "@/lib/uuid";
import { getArticle, getBlogs } from "@/lib/data/articles";
import { ArticleEditor } from "./article-editor";

export const dynamic = "force-dynamic";

export default async function EditArticlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // A non-UUID segment reaches `eq(x.id, id)` and Postgres THROWS 22P02 — a 500 where a 404 belongs.
  // `/produk/…` takes the catalog NUMBER, so merchants do try `/<this route>/1042`. See @tokophi/lib/uuid.
  if (!isUuid(id)) notFound();
  const [post, blogs] = await Promise.all([getArticle(id), getBlogs()]);
  if (!post) notFound();
  return <ArticleEditor post={post} blogs={blogs} />;
}
