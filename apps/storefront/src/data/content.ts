// Storefront CMS content — articles (Blog/Jurnal) + pages (Halaman).
//
// Separate from catalog.ts on purpose: the catalog is ONE cached bundle loaded for every request
// (products, collections, templates), and blog posts have no business being pulled in on a product
// page. These are their own short-TTL cached reads, same contract as storeCodPolicy().
//
// INVARIANT (same as catalog.ts): nothing runs at module scope — `astro build` must stay DB-free.
//
// PUBLISHING IS A SECURITY BOUNDARY, not a filter: every query below hard-filters `status='terbit'`.
// A draft is unreleased merchant work — it must 404, not merely be absent from a listing, or a
// guessable handle would leak it.
import { db, schema } from "@tokophi/db";
import { and, desc, eq } from "drizzle-orm";
import { cached } from "./cache";

export type ArticleCard = {
  handle: string;
  title: string;
  excerpt: string;
  imageUrl: string | null;
  author: string | null;
  blog: string | null;
  publishedAt: Date | null;
};
export type Article = ArticleCard & { body: string; seoTitle: string | null; seoDesc: string | null };
export type PageCard = { handle: string; title: string };
export type Page = PageCard & { body: string };

// ---------- body rendering ----------
// `body` is PLAIN TEXT typed by the merchant into a textarea (the admin's rich-text editor is still
// on the backlog). It is NEVER injected as HTML — `set:html` on merchant-authored text would be a
// stored-XSS hole, and the text isn't HTML anyway. Blocks are separated by a blank line; a block
// whose every line starts with "- " becomes a list. That is the whole format.
export type Block = { kind: "p"; text: string } | { kind: "ul"; items: string[] };

export function parseBody(body: string | null | undefined): Block[] {
  return (body ?? "")
    .split(/\r?\n\s*\r?\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk): Block => {
      const lines = chunk.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length > 0 && lines.every((l) => l.startsWith("- "))) {
        return { kind: "ul", items: lines.map((l) => l.slice(2).trim()) };
      }
      return { kind: "p", text: lines.join(" ") };
    });
}

/** Rough read time, shown on the article header. ~200 wpm, floored at 1 minute. */
export const readMinutes = (body: string | null | undefined) =>
  Math.max(1, Math.round((body ?? "").trim().split(/\s+/).filter(Boolean).length / 200));

/** Server-side only (SSR): a fixed published_at, so this is deterministic — never `Date.now()`. */
export const formatDate = (d: Date | null) =>
  d
    ? d.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    : "";

// ---------- queries ----------
export async function getArticles(storeId: string): Promise<ArticleCard[]> {
  return cached(`content:articles:${storeId}`, async () => {
    const rows = await db
      .select({
        handle: schema.articles.handle,
        title: schema.articles.title,
        excerpt: schema.articles.excerpt,
        imageUrl: schema.articles.imageUrl,
        author: schema.articles.author,
        blog: schema.blogs.title,
        publishedAt: schema.articles.publishedAt,
      })
      .from(schema.articles)
      .leftJoin(schema.blogs, eq(schema.blogs.id, schema.articles.blogId))
      .where(and(eq(schema.articles.storeId, storeId), eq(schema.articles.status, "terbit")))
      .orderBy(desc(schema.articles.publishedAt));
    return rows.map((r) => ({ ...r, excerpt: r.excerpt ?? "" }));
  });
}

export async function getArticle(storeId: string, handle: string): Promise<Article | null> {
  return cached(`content:article:${storeId}:${handle}`, async () => {
    const [row] = await db
      .select({
        handle: schema.articles.handle,
        title: schema.articles.title,
        excerpt: schema.articles.excerpt,
        imageUrl: schema.articles.imageUrl,
        author: schema.articles.author,
        blog: schema.blogs.title,
        publishedAt: schema.articles.publishedAt,
        body: schema.articles.body,
        seoTitle: schema.articles.seoTitle,
        seoDesc: schema.articles.seoDesc,
      })
      .from(schema.articles)
      .leftJoin(schema.blogs, eq(schema.blogs.id, schema.articles.blogId))
      .where(
        and(
          eq(schema.articles.storeId, storeId),
          eq(schema.articles.handle, handle),
          eq(schema.articles.status, "terbit"),
        ),
      )
      .limit(1);
    return row ? { ...row, excerpt: row.excerpt ?? "", body: row.body ?? "" } : null;
  });
}

export async function getPages(storeId: string): Promise<PageCard[]> {
  return cached(`content:pages:${storeId}`, async () => {
    return db
      .select({ handle: schema.pages.handle, title: schema.pages.title })
      .from(schema.pages)
      .where(and(eq(schema.pages.storeId, storeId), eq(schema.pages.status, "terbit")))
      .orderBy(schema.pages.title);
  });
}

export async function getPage(storeId: string, handle: string): Promise<Page | null> {
  return cached(`content:page:${storeId}:${handle}`, async () => {
    const [row] = await db
      .select({ handle: schema.pages.handle, title: schema.pages.title, body: schema.pages.body })
      .from(schema.pages)
      .where(
        and(
          eq(schema.pages.storeId, storeId),
          eq(schema.pages.handle, handle),
          eq(schema.pages.status, "terbit"),
        ),
      )
      .limit(1);
    return row ? { ...row, body: row.body ?? "" } : null;
  });
}
