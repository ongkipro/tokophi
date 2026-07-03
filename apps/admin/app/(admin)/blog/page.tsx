import { getArticles } from "@/lib/data/articles";
import { BlogClient } from "./blog-client";

export const dynamic = "force-dynamic";

export default async function BlogPage() {
  const posts = await getArticles();
  return <BlogClient posts={posts} />;
}
