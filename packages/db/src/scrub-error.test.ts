import { inspect } from "node:util";
import { DrizzleQueryError } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { pgError, uniqueViolationConstraint } from "@tokophi/lib/pg-errors";
import { installQueryErrorScrub, scrubQueryError } from "./scrub-error";

// Built with drizzle's REAL error class, so a future drizzle that changes its shape fails here.
const pgCause = Object.assign(new Error("duplicate key"), { code: "23505", constraint_name: "users_email_unique", detail: "Key (email)=(ada@example.test) already exists." });
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
  it("the printed error is clean too: stack and util.inspect (what console.error uses), even when stack was read first", () => {
    const e = make();
    void e.stack; // V8 formats lazily — a logging hook that touched it first must not defeat the scrub
    scrubQueryError(e);
    const shown = inspect(e, { depth: 5 });
    expect(shown).not.toContain("SECRETHASH");
    expect(shown).not.toContain("ada@example.test"); // params AND the pg `detail` (Key (email)=(…))
    expect(shown).toContain("users_email_unique"); // the diagnostic that matters survives
  });
  it("leaves a foreign error untouched and returns the same object", () => {
    const plain = new Error("boom");
    expect(scrubQueryError(plain)).toBe(plain);
    expect(plain.message).toBe("boom");
  });
});

describe("installQueryErrorScrub", () => {
  it("wraps drizzle's single error-construction point (fails loudly here if a drizzle upgrade moves it)", () => {
    expect(installQueryErrorScrub()).toBe(true);
    expect(installQueryErrorScrub()).toBe(true); // idempotent
  });
});
