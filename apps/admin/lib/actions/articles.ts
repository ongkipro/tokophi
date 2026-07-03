"use server";
import { db, schema } from "@indostore/db";
import { asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

const ADMIN_TODAY = new Date("2026-06-30T00:00:00Z");

export type ArticleInput = {
  title: string;
  handle: string;
  body?: string;
  excerpt?: string;
  author?: string;
  published: boolean;
};

async function storeId() {
  const [s] = await db.select({ id: schema.stores.id }).from(schema.stores).limit(1);
  return s!.id;
}

const fields = (i: ArticleInput) => ({
  title: i.title.trim(),
  handle: i.handle.trim(),
  body: i.body || null,
  excerpt: i.excerpt || null,
  author: i.author || null,
  status: (i.published ? "terbit" : "draft") as "terbit" | "draft",
  publishedAt: i.published ? ADMIN_TODAY : null,
});

export async function createArticle(input: ArticleInput): Promise<string> {
  const sid = await storeId();
  // No blog picker in the editor → assign new articles to the store's first blog.
  const [blog] = await db.select({ id: schema.blogs.id }).from(schema.blogs).where(eq(schema.blogs.storeId, sid)).orderBy(asc(schema.blogs.title)).limit(1);
  const [a] = await db.insert(schema.articles).values({ storeId: sid, blogId: blog!.id, comments: 0, ...fields(input) }).returning();
  revalidatePath("/blog");
  return a.id;
}

export async function updateArticle(id: string, input: ArticleInput): Promise<void> {
  await db.update(schema.articles).set(fields(input)).where(eq(schema.articles.id, id));
  revalidatePath("/blog");
  revalidatePath(`/blog/${id}`);
}

export async function deleteArticle(id: string): Promise<void> {
  await db.delete(schema.articles).where(eq(schema.articles.id, id));
  revalidatePath("/blog");
}
