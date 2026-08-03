import { getBlogs } from "@/lib/data/articles";
import { ArticleEditor } from "../[id]/article-editor";

// `force-dynamic` because the picker's options are this store's rows, not a build-time constant.
export const dynamic = "force-dynamic";

export default async function NewArticle() {
  return <ArticleEditor blogs={await getBlogs()} />;
}
