import { describe, expect, it } from "vitest";
import { isPubliclyServable, lockReason } from "./store-servable";

const D = new Date("2026-08-01T00:00:00Z");

describe("isPubliclyServable", () => {
  it("serves a normal store", () =>
    expect(isPubliclyServable({ suspendedAt: null, approvedAt: D })).toBe(true));

  // THE bug SEC-1 is about: self-serve signup creates a store LOCKED and unapproved, yet its
  // storefront was fully public — getStoreBySlug filtered on slug alone.
  it("refuses a signup awaiting first review", () =>
    expect(isPubliclyServable({ suspendedAt: D, approvedAt: null })).toBe(false));

  it("refuses a store suspended for cause", () =>
    expect(isPubliclyServable({ suspendedAt: D, approvedAt: D })).toBe(false));

  // approvedAt is NEVER cleared (schema 0090), so it must not re-open a suspended store.
  it("approval does not override a later suspension", () =>
    expect(isPubliclyServable({ suspendedAt: D, approvedAt: D })).toBe(false));

  // A store approved long ago and never suspended is the ordinary case.
  it("serves an approved, unsuspended store", () =>
    expect(isPubliclyServable({ suspendedAt: null, approvedAt: null })).toBe(true));
});

describe("lockReason", () => {
  it("is null when nothing is locked", () =>
    expect(lockReason({ suspendedAt: null, approvedAt: D })).toBeNull());
  it("distinguishes a pending signup from a punishment", () => {
    expect(lockReason({ suspendedAt: D, approvedAt: null })).toBe("awaiting-first-review");
    expect(lockReason({ suspendedAt: D, approvedAt: D })).toBe("suspended-for-cause");
  });
});
