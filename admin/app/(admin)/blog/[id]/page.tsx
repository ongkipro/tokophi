import { BLOG_POSTS } from "@/lib/mock/store";
import { notFound } from "next/navigation";
import { ArticleEditor } from "./article-editor";

export function generateStaticParams() {
  return BLOG_POSTS.map((p) => ({ id: p.id }));
}

export default async function EditArticlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const post = BLOG_POSTS.find((p) => p.id === id);
  if (!post) notFound();
  return <ArticleEditor post={post} />;
}
