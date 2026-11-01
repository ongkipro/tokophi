import { DrizzleQueryError } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { pgError, uniqueViolationConstraint } from "@tokophi/lib/pg-errors";
import { scrubQueryError } from "./scrub-error";

// Built with drizzle's REAL error class, so a future drizzle that changes its shape fails here.
const pgCause = Object.assign(new Error("duplicate key"), { code: "23505", constraint_name: "users_email_unique" });
const make = () => new DrizzleQueryError('insert into "users" ("email","password_hash") values ($1,$2)', ["ada@example.test", "$argon2id$SECRETHASH"], pgCause);

describe("scrubQueryError", () => {
  it("drizzle really does put the bound values in the message (why this file exists)", () => {
    expect(make().message).toContain("SECRETHASH");
  });
  it("removes the values from message and params, keeps the SQL", () => {
    const e = scrubQueryError(make());
    expect(e.message).toContain('insert into "users"');
    expect(e.message).not.toContain("SECRETHASH");
    expect(e.message).not.toContain("ada@example.test");
    expect(e.params).toEqual([]);
  });
  it("keeps the cause chain readable: the pg readers still see the constraint", () => {
    const e = scrubQueryError(make());
    expect(e).toBeInstanceOf(DrizzleQueryError);
    expect(pgError(e)).toEqual({ code: "23505", constraint_name: "users_email_unique" });
    expect(uniqueViolationConstraint(e)).toBe("users_email_unique");
  });
  it("leaves a foreign error untouched and returns the same object", () => {
    const plain = new Error("boom");
    expect(scrubQueryError(plain)).toBe(plain);
    expect(plain.message).toBe("boom");
  });
});
