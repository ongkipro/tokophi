import "server-only";
import { schema } from "@indostore/db";
import { withCurrentTenant, type Tx } from "@/lib/tenant";
import { desc, eq } from "drizzle-orm";
import type { BlogPost } from "@/lib/mock/store";

const ADMIN_TODAY = new Date("2026-06-30T00:00:00Z");

const sel = {
  id: schema.articles.id,
  title: schema.articles.title,
  handle: schema.articles.handle,
  blog: schema.blogs.title,
  author: schema.articles.author,
  status: schema.articles.status,
  excerpt: schema.articles.excerpt,
  comments: schema.articles.comments,
  publishedAt: schema.articles.publishedAt,
};

function q(db: Tx) {
  return db.select(sel).from(schema.articles).innerJoin(schema.blogs, eq(schema.blogs.id, schema.articles.blogId));
}

function toPost(r: {
  id: string; title: string; handle: string; blog: string; author: string | null;
  status: "terbit" | "draft"; excerpt: string | null; comments: number; publishedAt: Date | null;
}): BlogPost {
  return {
    id: r.id,
    title: r.title,
    handle: r.handle,
    blog: r.blog,
    author: r.author ?? "",
    published: r.status === "terbit",
    publishedDaysAgo: r.publishedAt ? Math.round((ADMIN_TODAY.getTime() - r.publishedAt.getTime()) / 86_400_000) : 0,
    excerpt: r.excerpt ?? "",
    comments: r.comments,
  };
}

export async function getArticles(): Promise<BlogPost[]> {
  return withCurrentTenant(async (db) => {
    const rows = await q(db).orderBy(desc(schema.articles.publishedAt));
    return rows.map(toPost);
  });
}

export async function getArticle(id: string): Promise<BlogPost | null> {
  return withCurrentTenant(async (db) => {
    const rows = await q(db).where(eq(schema.articles.id, id)).limit(1);
    return rows[0] ? toPost(rows[0]) : null;
  });
}
