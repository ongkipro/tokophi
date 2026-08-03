import { schema } from "@tokophi/db";
import { sql, type SQL } from "drizzle-orm";

/**
 * The seller's Blog list order: most recently PUBLISHED first, drafts last.
 *
 * ⚠️ `nulls last` IS THE DEFINITION, not decoration — this is the same NULLS-FIRST class as
 * `latestPaymentFirst()` beside it, one screen over. Postgres sorts `DESC` as **NULLS FIRST**, and a
 * draft has no `published_at`, so drizzle's `desc(articles.publishedAt)` — a bare `desc` — put EVERY
 * draft above EVERY published post. Measured on the dev DB: the one seeded draft
 * ("Koleksi Lebaran 2027 — Draf, Belum Tayang") sat on top of all 15 published articles. A merchant
 * with a folder of half-started drafts sees only those, and their live blog begins below the fold.
 *
 * WHY DRAFTS SIT AT THE BOTTOM, and not on top:
 * this list is ranked on ONE axis — when the post went live. A draft has no value on that axis at
 * all, so any position it takes is a decision, not a sort. Bottom is the honest one: the merchant's
 * published catalogue is what the shop actually shows, it is the thing they scan for "what went out
 * and when", and drafts are already named as drafts by their own badge in the row. Hoisting them
 * would silently switch the axis to "unfinished first" for part of the table while the date column
 * beside it keeps claiming to be sorted.
 *
 * `title asc` is the tie-break, because drafts are ALL tied — every one of them is NULL. Without it
 * Postgres is free to return them in whatever order the plan happens to produce, so the list could
 * reshuffle between two loads of the same unchanged data. (It also settles two posts published in
 * the same second, deterministically.)
 *
 * A function, not a constant, so each query gets a fresh `SQL` node. It lives in its own module —
 * with no `@/` imports — so a test can import it without pulling the tenant/session layer in.
 */
export const publishedFirst = (): SQL =>
  sql`${schema.articles.publishedAt} desc nulls last, ${schema.articles.title} asc`;
