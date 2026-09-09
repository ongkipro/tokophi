import "server-only";
import { schema } from "@tokophi/db";
import { withCurrentTenant, type Tx } from "@/lib/tenant";
import { publishedFirst } from "@tokophi/db/article-order";
import { asc, eq } from "drizzle-orm";
import type { BlogPost } from "@/lib/types/domain";

// ⚠️ `body` and `imageUrl` were NOT here, and their absence was destroying merchant work.
//
// The editor is a FORM: it renders what this returns and writes back everything in `ArticleInput`.
// With no `body` selected, `article-editor.tsx` fabricated one — `${post.excerpt}\n\n${post.title}` —
// so opening any existing article and pressing **Simpan** replaced its real text with two lines of
// summary. Measured on the demo: `cara-merawat-rajut` holds 908 characters the merchant wrote; one
// click would have left 60. A read layer that under-selects is not "missing a field", it is a silent
// delete on the next save. If you add a column to ArticleInput, add it HERE first.
const sel = {
  id: schema.articles.id,
  title: schema.articles.title,
  handle: schema.articles.handle,
  blogId: schema.articles.blogId,
  blog: schema.blogs.title,
  author: schema.articles.author,
  status: schema.articles.status,
  excerpt: schema.articles.excerpt,
  body: schema.articles.body,
  imageUrl: schema.articles.imageUrl,
  comments: schema.articles.comments,
  publishedAt: schema.articles.publishedAt,
};

function q(db: Tx) {
  return db.select(sel).from(schema.articles).innerJoin(schema.blogs, eq(schema.blogs.id, schema.articles.blogId));
}

function toPost(r: {
  id: string; title: string; handle: string; blog: string; blogId: string; author: string | null;
  status: "terbit" | "draft"; excerpt: string | null; body: string | null; imageUrl: string | null;
  comments: number; publishedAt: Date | null;
}): BlogPost {
  return {
    id: r.id,
    title: r.title,
    handle: r.handle,
    blog: r.blog,
    blogId: r.blogId,
    author: r.author ?? "",
    published: r.status === "terbit",
    // Real clock. This was `ADMIN_TODAY = 2026-06-30`, the seed's frame: an article published today
    // rendered "-32 hari lalu". Anchoring a READ to the seed is the same rule the WRITE side broke.
    publishedDaysAgo: r.publishedAt ? Math.round((Date.now() - r.publishedAt.getTime()) / 86_400_000) : 0,
    excerpt: r.excerpt ?? "",
    body: r.body ?? "",
    imageUrl: r.imageUrl ?? "",
    comments: r.comments,
  };
}

export type BlogRef = { id: string; title: string };

/**
 * The store's OWN blogs — the `/blog` filter tabs, their count badges and the editor's picker.
 *
 * ⚠️ All three used to read `BLOG_CATEGORIES` from `lib/mock/store.ts`: the literal
 * `["Berita Toko", "Tips & Panduan"]`. That is what the SEED happens to write for
 * `batik-nusantara` — so the screen looked correct on exactly one store and on no other. A store
 * whose `blogs.title` differs got a tab strip of names it does not have, every badge reading 0,
 * and no way to reach its own articles; a store with no `blogs` row at all (every store created
 * through `/daftar` or the super-admin — only the seed writes that table) got the same, and its
 * editor's picker defaulted to a blog that does not exist.
 */
export async function getBlogs(): Promise<BlogRef[]> {
  return withCurrentTenant(async (db, storeId) =>
    db
      .select({ id: schema.blogs.id, title: schema.blogs.title })
      .from(schema.blogs)
      // `blogs` HAS a store_id and is RLS'd, but the WHERE is the rule and the policy is only the
      // net (AGENTS.md) — this is also what makes the query correct when read as owner.
      .where(eq(schema.blogs.storeId, storeId))
      .orderBy(asc(schema.blogs.title)),
  );
}

export async function getArticles(): Promise<BlogPost[]> {
  return withCurrentTenant(async (db) => {
    const rows = await q(db).orderBy(publishedFirst());
    return rows.map(toPost);
  });
}

export async function getArticle(id: string): Promise<BlogPost | null> {
  return withCurrentTenant(async (db) => {
    const rows = await q(db).where(eq(schema.articles.id, id)).limit(1);
    return rows[0] ? toPost(rows[0]) : null;
  });
}
