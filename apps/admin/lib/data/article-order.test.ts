import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql, desc, eq } from "drizzle-orm";

// The seller's Blog list order — published work first, drafts last.
//
// This is a DB test because nothing else can see the bug. `desc(articles.published_at)` and
// `published_at desc nulls last` type-check identically, lint identically and build identically;
// only Postgres, and only on a store that has BOTH a draft and a published post, gives two different
// answers. It shipped once already in the payment ordering (`order-payment.test.ts` beside this one),
// which is why the class now gets pinned wherever it appears.
//
// ISOLATION: everything runs in a transaction that is ALWAYS rolled back, against the throwaway
// `*_test` database vitest's globalSetup resolves (NEVER the shared dev DB — see AGENTS.md). Without
// TEST_DATABASE_URL the suite SKIPS rather than fails, so a plain `vitest run` stays green.

const URL = process.env.TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle>;
// `article-order.ts` imports `schema` from @tokophi/db as a VALUE, and that module throws at import
// time when DATABASE_URL is unset — so both are dynamic-imported after pointing it at the throwaway
// DB, exactly as order-payment.test.ts does.
let publishedFirst: (typeof import("./article-order"))["publishedFirst"];
let schema: (typeof import("@tokophi/db"))["schema"];

beforeAll(async () => {
  if (!URL) return;
  process.env.DATABASE_URL ??= URL;
  ({ publishedFirst } = await import("./article-order"));
  ({ schema } = await import("@tokophi/db"));
  client = postgres(URL, { max: 1 });
  // Must match @tokophi/db's client, or the query builder emits "publishedAt" instead of "published_at".
  db = drizzle(client, { casing: "snake_case" });
});
afterAll(async () => {
  if (client) await client.end();
});

class Rollback extends Error {}
async function inTxn(fn: (tx: typeof db) => Promise<void>) {
  try {
    await db.transaction(async (tx) => {
      await fn(tx as unknown as typeof db);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}

/** A blog holding two published posts and two drafts — the shape the seller's list is ranked on. */
async function mkBlog(tx: typeof db): Promise<string> {
  const [acc] = await tx.execute<{ id: string }>(sql`insert into accounts (name) values ('Test Acc') returning id`);
  const [store] = await tx.execute<{ id: string }>(
    sql`insert into stores (account_id, name, slug) values (${acc.id}, 'Test Store', ${"blog-" + Math.random()}) returning id`,
  );
  const [blog] = await tx.execute<{ id: string }>(
    sql`insert into blogs (store_id, title, handle) values (${store.id}, 'Jurnal', 'jurnal') returning id`,
  );
  // Inserted drafts-first so row order alone cannot produce the right answer.
  const rows: Array<[string, string, string | null]> = [
    ["Draf B", "draf-b", null],
    ["Draf A", "draf-a", null],
    ["Lama", "lama", "2026-06-01"],
    ["Baru", "baru", "2026-06-20"],
  ];
  for (const [title, handle, at] of rows) {
    await tx.execute(sql`
      insert into articles (blog_id, store_id, title, handle, status, published_at)
      values (${blog.id}, ${store.id}, ${title}, ${handle},
              ${at ? "terbit" : "draft"}::content_status, ${at})`);
  }
  return blog.id;
}

suite("publishedFirst — the Blog list ranks published work above drafts", () => {
  it("published posts come first, newest first; drafts sit at the bottom", async () => {
    await inTxn(async (tx) => {
      const blogId = await mkBlog(tx);
      const titles = (
        await tx
          .select({ t: schema.articles.title })
          .from(schema.articles)
          .where(eq(schema.articles.blogId, blogId))
          .orderBy(publishedFirst())
      ).map((r) => r.t);

      expect(titles).toEqual(["Baru", "Lama", "Draf A", "Draf B"]);
    });
  });

  it("a bare DESC buries every published post under every draft (this is the whole bug)", async () => {
    await inTxn(async (tx) => {
      const blogId = await mkBlog(tx);
      const titles = (
        await tx
          .select({ t: schema.articles.title })
          .from(schema.articles)
          .where(eq(schema.articles.blogId, blogId))
          .orderBy(desc(schema.articles.publishedAt), schema.articles.title)
      ).map((r) => r.t);

      // Postgres sorts DESC as NULLS FIRST, and a draft has no published_at. This assertion exists so
      // nobody "simplifies" the fragment back to drizzle's `desc()`.
      expect(titles.slice(0, 2)).toEqual(["Draf A", "Draf B"]);
    });
  });
});
