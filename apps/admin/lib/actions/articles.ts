"use server";
import { schema } from "@tokophi/db";
import { asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";

const ADMIN_TODAY = new Date("2026-06-30T00:00:00Z");

export type ArticleInput = {
  title: string;
  handle: string;
  body?: string;
  excerpt?: string;
  author?: string;
  /** Featured image. Either an uploaded `/api/uploads/<name>` path or "" for none. */
  imageUrl?: string;
  published: boolean;
};

// ⚠️ EVERY field here is written on every save — this is a full replace, not a patch. So anything
// listed must also be READ in lib/data/articles.ts and rendered by the editor, or the save writes a
// blank over it. `imageUrl` was the second half of a bug the first half of which was `body`: the
// editor's "Gambar unggulan" card was a dead button with no handler, so the column could only ever
// be set by the seed and a merchant could never give their article a picture.
const fields = (i: ArticleInput) => ({
  title: i.title.trim(),
  handle: i.handle.trim(),
  body: i.body || null,
  excerpt: i.excerpt || null,
  author: i.author || null,
  imageUrl: i.imageUrl || null,
  status: (i.published ? "terbit" : "draft") as "terbit" | "draft",
  publishedAt: i.published ? ADMIN_TODAY : null,
});

export async function createArticle(input: ArticleInput): Promise<string> {
  const { storeId: sid } = await requireCapability("content:write");
  const id = await withTenant(sid, async (db) => {
    // No blog picker in the editor → assign new articles to the store's first blog.
    const [blog] = await db.select({ id: schema.blogs.id }).from(schema.blogs).where(eq(schema.blogs.storeId, sid)).orderBy(asc(schema.blogs.title)).limit(1);
    const [a] = await db.insert(schema.articles).values({ storeId: sid, blogId: blog!.id, comments: 0, ...fields(input) }).returning();
    return a.id;
  });
  revalidatePath("/blog");
  return id;
}

export async function updateArticle(id: string, input: ArticleInput): Promise<void> {
  const { storeId: sid } = await requireCapability("content:write");
  await withTenant(sid, (db) => db.update(schema.articles).set(fields(input)).where(eq(schema.articles.id, id)));
  revalidatePath("/blog");
  revalidatePath(`/blog/${id}`);
}

export async function deleteArticle(id: string): Promise<void> {
  const { storeId: sid } = await requireCapability("content:write");
  await withTenant(sid, (db) => db.delete(schema.articles).where(eq(schema.articles.id, id)));
  revalidatePath("/blog");
}
