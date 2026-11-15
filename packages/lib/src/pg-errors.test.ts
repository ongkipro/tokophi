import { describe, expect, it } from "vitest";
import { isForeignKeyViolation, pgError, uniqueViolationConstraint } from "./pg-errors";

const pg = (code: string, constraint_name?: string) => Object.assign(new Error("pg"), { code, constraint_name });
// drizzle-orm >= 0.44 shape: the driver error hangs off `.cause` of the thrown value.
const wrapped = (inner: unknown) => Object.assign(new Error("Failed query"), { cause: inner });

describe("pgError / readers survive drizzle's DrizzleQueryError wrapping", () => {
  it("reads an unwrapped driver error (postgres.js shape)", () => {
    expect(uniqueViolationConstraint(pg("23505", "users_email_unique"))).toBe("users_email_unique");
  });
  it("reads the same error one and two levels down a cause chain", () => {
    expect(uniqueViolationConstraint(wrapped(pg("23505", "stores_slug_unique")))).toBe("stores_slug_unique");
    expect(uniqueViolationConstraint(wrapped(wrapped(pg("23505", "a"))))).toBe("a");
  });
  it("a 23505 without a name is still a conflict (empty string), anything else is null", () => {
    expect(uniqueViolationConstraint(wrapped(pg("23505")))).toBe("");
    expect(uniqueViolationConstraint(wrapped(pg("23503", "x")))).toBeNull();
    expect(uniqueViolationConstraint(new Error("nope"))).toBeNull();
    expect(uniqueViolationConstraint(null)).toBeNull();
  });
  it("ignores Node errno codes such as ENOTFOUND (not SQLSTATE)", () => {
    expect(pgError(Object.assign(new Error("dns"), { code: "ENOTFOUND" }))).toBeNull();
  });
  it("isForeignKeyViolation: bare code, or that ONE named constraint", () => {
    const e = wrapped(pg("23503", "ledger_entries_order_id_orders_id_fk"));
    expect(isForeignKeyViolation(e)).toBe(true);
    expect(isForeignKeyViolation(e, "ledger_entries_order_id_orders_id_fk")).toBe(true);
    expect(isForeignKeyViolation(e, "some_other_fk")).toBe(false);
    expect(isForeignKeyViolation(wrapped(pg("23505", "x")))).toBe(false);
  });
  it("is bounded: a cyclic cause chain terminates", () => {
    const a: { cause?: unknown } = {};
    a.cause = a;
    expect(pgError(a)).toBeNull();
  });
});
