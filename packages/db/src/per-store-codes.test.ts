import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { discounts, purchaseOrders } from "./schema";

// Codes are unique PER STORE (migration 0084), not across the platform.
//
// A bare `.unique()` on `code` meant the first merchant to use a string owned it forever. For
// `discounts` that blocked every other shop from `GAJIAN25` — and the rejection told them the code was
// taken, which is a working way to probe a competitor's codes. For `purchase_orders` it was worse than
// unfair: the code is derived from a clock fragment, so two POs anywhere on the platform at the same
// point in that cycle collided and the second simply failed to save.
//
// This is pinned here because the failure mode is silent in BOTH directions: re-adding `.unique()`
// type-checks, runs, and passes every other test — it only shows up when a second merchant picks a
// popular code, i.e. in production, to someone who cannot see why.

const TABLES = [
  ["discounts", discounts],
  ["purchase_orders", purchaseOrders],
] as const;

describe("code uniqueness is scoped to the store", () => {
  it.each(TABLES)("%s has a composite (store_id, code) unique", (_name, table) => {
    const cfg = getTableConfig(table);
    // `getTableConfig` reports the SCHEMA property names (camelCase), not the SQL identifiers.
    const shapes = cfg.uniqueConstraints.map((u) => u.columns.map((c) => c.name).sort().join("+"));
    expect(shapes).toContain("code+storeId");
  });

  it.each(TABLES)("%s has NO column-level unique on `code`", (_name, table) => {
    // The one that would silently restore the platform-wide constraint.
    const cfg = getTableConfig(table);
    const code = cfg.columns.find((c) => c.name === "code");
    expect(code, "the `code` column should exist").toBeDefined();
    expect(code!.isUnique, "`code` must not be globally unique").toBeFalsy();
  });

  it("both tables carry store_id, which is what the scope is built on", () => {
    for (const [name, table] of TABLES) {
      const cfg = getTableConfig(table);
      expect(cfg.columns.map((c) => c.name), `${name}.storeId`).toContain("storeId");
    }
  });
});
