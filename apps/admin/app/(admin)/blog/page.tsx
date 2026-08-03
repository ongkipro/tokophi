import { getArticles, getBlogs } from "@/lib/data/articles";
import { BlogClient } from "./blog-client";

export const dynamic = "force-dynamic";

export default async function BlogPage() {
  const [posts, blogs] = await Promise.all([getArticles(), getBlogs()]);
  return <BlogClient posts={posts} blogs={blogs.map((b) => b.title)} />;
}
