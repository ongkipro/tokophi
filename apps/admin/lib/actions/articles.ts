"use server";
import { schema } from "@tokophi/db";
import { asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { publishedAtFor } from "@/lib/publish-date";
import { requireCapability } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";

export type ArticleInput = {
  title: string;
  handle: string;
  body?: string;
  excerpt?: string;
  author?: string;
  /** Featured image. Either an uploaded `/api/uploads/<name>` path or "" for none. */
  imageUrl?: string;
  /** Which blog the article belongs to. Omitted / unknown → the store's first blog. */
  blogId?: string;
  published: boolean;
};

/**
 * Resolve the blog this article goes in, **inside the tenant txn**.
 *
 * ⚠️ `articles.blog_id` is an FK to a table this action does not otherwise touch, so a client-sent
 * id must be READ BACK under RLS before it is written — the child-table rule in AGENTS.md. An id
 * belonging to another store simply does not come back, and we fall through to this store's own
 * first blog rather than filing the article into a stranger's.
 *
 * ⚠️ A STORE WITH NO BLOGS GETS ONE. `blog!.id` on an empty result was a runtime crash on the
 * merchant's first ever "Simpan": ONLY the seed writes `blogs`, and it writes them for the demo
 * store alone — so every store created through `/daftar` or the super-admin could never publish an
 * article at all. `handle: "blog"` matches the storefront route the shopper reads.
 */
async function resolveBlogId(db: Parameters<Parameters<typeof withTenant>[1]>[0], storeId: string, wanted?: string): Promise<string> {
  const rows = await db.select({ id: schema.blogs.id }).from(schema.blogs).where(eq(schema.blogs.storeId, storeId)).orderBy(asc(schema.blogs.title));
  if (wanted && rows.some((r) => r.id === wanted)) return wanted;
  if (rows[0]) return rows[0].id;
  const [made] = await db.insert(schema.blogs).values({ storeId, title: "Blog", handle: "blog" }).returning({ id: schema.blogs.id });
  return made.id;
}

// ⚠️ EVERY field here is written on every save — this is a full replace, not a patch. So anything
// listed must also be READ in lib/data/articles.ts and rendered by the editor, or the save writes a
// blank over it. `imageUrl` was the second half of a bug the first half of which was `body`: the
// editor's "Gambar unggulan" card was a dead button with no handler, so the column could only ever
// be set by the seed and a merchant could never give their article a picture.
//
// ⚠️ `publishedAt` therefore takes the row's CURRENT value — never a fresh anchor. It was a frozen
// `ADMIN_TODAY = 2026-06-30`, so every save re-stamped the seed's frame over the truth and walked an
// already-published article's date backwards, a day further every day. See `lib/publish-date.ts`.
const fields = (i: ArticleInput, currentPublishedAt: Date | null) => ({
  title: i.title.trim(),
  handle: i.handle.trim(),
  body: i.body || null,
  excerpt: i.excerpt || null,
  author: i.author || null,
  imageUrl: i.imageUrl || null,
  status: (i.published ? "terbit" : "draft") as "terbit" | "draft",
  publishedAt: publishedAtFor(i.published, currentPublishedAt),
});

export async function createArticle(input: ArticleInput): Promise<string> {
  const { storeId: sid } = await requireCapability("content:write");
  const id = await withTenant(sid, async (db) => {
    const blogId = await resolveBlogId(db, sid, input.blogId);
    const [a] = await db.insert(schema.articles).values({ storeId: sid, blogId, comments: 0, ...fields(input, null) }).returning();
    return a.id;
  });
  revalidatePath("/blog");
  return id;
}

export async function updateArticle(id: string, input: ArticleInput): Promise<void> {
  const { storeId: sid } = await requireCapability("content:write");
  await withTenant(sid, async (db) => {
    // Read the row's own publish date and keep it — an edit changes the article, not when it went
    // live. (The read is also the tenant check: `articles` is RLS'd, so a foreign id returns nothing
    // and the update below is skipped rather than silently no-opping. Same shape as updateDiscount.)
    const [cur] = await db
      .select({ publishedAt: schema.articles.publishedAt, blogId: schema.articles.blogId })
      .from(schema.articles)
      .where(eq(schema.articles.id, id))
      .limit(1);
    if (!cur) return;
    // The Blog picker used to be a DEAD CONTROL: `blog` never left the editor's local state (it was
    // not on ArticleInput at all), so a merchant who moved an article to another blog and pressed
    // Simpan saw a success toast and nothing moved. It persists now — via an id read back under RLS.
    const blogId = input.blogId ? await resolveBlogId(db, sid, input.blogId) : cur.blogId;
    await db.update(schema.articles).set({ ...fields(input, cur.publishedAt), blogId }).where(eq(schema.articles.id, id));
  });
  revalidatePath("/blog");
  revalidatePath(`/blog/${id}`);
}

export async function deleteArticle(id: string): Promise<void> {
  const { storeId: sid } = await requireCapability("content:write");
  await withTenant(sid, (db) => db.delete(schema.articles).where(eq(schema.articles.id, id)));
  revalidatePath("/blog");
}
