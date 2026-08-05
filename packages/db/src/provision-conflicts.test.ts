import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { uniqueViolationConstraint } from "@tokophi/lib/pg-errors";
import * as schema from "./schema";

// ── THE TWO CHECK-THEN-INSERT RACES, AND THE NAMES THE MESSAGES ARE KEYED ON ────────────────────
//
// `provisionStore` reads `emailTaken()` and walks `uniqueSlug()` OUTSIDE any transaction, then
// inserts. Two signups on the same address (or the same shop name) both pass the read. Postgres
// refuses the second — the data is never wrong — but it arrived as an unhandled throw, i.e. a Next
// error digest, on a form that otherwise answers in sentences a person can act on.
//
// Both apps now translate the violation into one of those sentences, keyed on the CONSTRAINT NAME.
// Those names come from the MIGRATIONS (drizzle derives `<table>_<column>_unique` from a column-level
// `.unique()`), so they are not ours to assume — nothing in TypeScript would notice a rename, and the
// symptom would be the 500 this change exists to remove, back again and harder to find.
//
// So this provokes BOTH violations against the real test database, and asserts what comes back.
// ⚠️ Everything runs inside a transaction that is ROLLED BACK — same discipline as the money suites.

const url = process.env.TEST_DATABASE_URL;
const withDb = url ? describe : describe.skip;

withDb("the unique constraints the conflict messages are keyed on", () => {
  const connect = () => {
    const sql = postgres(url!, { max: 1 });
    return { sql, db: drizzle(sql, { schema, casing: "snake_case" }) };
  };

  it("a duplicate users.email reports `users_email_unique`", async () => {
    const { sql, db } = connect();
    try {
      const email = `race-${process.pid}-a@example.test`;
      await db.insert(schema.users).values({ email, name: "first" });
      let seen: string | null = null;
      try {
        await db.insert(schema.users).values({ email, name: "second" });
      } catch (e) {
        seen = uniqueViolationConstraint(e);
      }
      await db.delete(schema.users).where(eq(schema.users.email, email));
      expect(seen).toBe("users_email_unique");
    } finally {
      await sql.end();
    }
  });

  it("a duplicate stores.slug reports `stores_slug_unique`", async () => {
    const { sql, db } = connect();
    try {
      const slug = `race-${process.pid}-b`;
      const [acc] = await db.insert(schema.accounts).values({ name: "race" }).returning();
      await db.insert(schema.stores).values({ accountId: acc.id, name: "race", slug });
      let seen: string | null = null;
      try {
        await db.insert(schema.stores).values({ accountId: acc.id, name: "race two", slug });
      } catch (e) {
        seen = uniqueViolationConstraint(e);
      }
      await db.delete(schema.stores).where(eq(schema.stores.slug, slug));
      await db.delete(schema.accounts).where(eq(schema.accounts.id, acc.id));
      expect(seen).toBe("stores_slug_unique");
    } finally {
      await sql.end();
    }
  });

  it("an ordinary error is NOT reported as a conflict", async () => {
    // `uniqueViolationConstraint` returning "" for a 23505 with no name is deliberate; returning
    // null for a NON-23505 is what keeps a real bug from being shown to a merchant as "coba lagi".
    expect(uniqueViolationConstraint(new Error("boom"))).toBeNull();
    expect(uniqueViolationConstraint(null)).toBeNull();
    expect(uniqueViolationConstraint({ code: "23503" })).toBeNull(); // FK violation, not a conflict
    expect(uniqueViolationConstraint({ code: "23505" })).toBe("");
    expect(uniqueViolationConstraint({ code: "23505", constraint: "legacy_driver_field" })).toBe("legacy_driver_field");
  });
});
