import { describe, expect, it } from "vitest";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { orderLineItems, orders, payments } from "./schema";

function indexByName(table: PgTable, name: string) {
  const found = getTableConfig(table).indexes.find((index) => index.config.name === name);
  expect(found, `${name} must be declared in the Drizzle schema`).toBeDefined();
  return found!;
}

function columnNames(table: PgTable, name: string) {
  return indexByName(table, name).config.columns.map((column) =>
    "name" in column ? column.name : undefined,
  );
}

describe("migration lookup indexes are represented in the Drizzle schema", () => {
  it("declares the orders store/placed index", () => {
    expect(columnNames(orders, "orders_store_placed_idx")).toEqual(["storeId", "placedAt"]);
  });

  it("declares both partial payment lookup indexes", () => {
    const trx = indexByName(payments, "payments_trx_idx");
    const reff = indexByName(payments, "payments_reff_idx");

    expect(columnNames(payments, "payments_trx_idx")).toEqual(["trxId"]);
    expect(columnNames(payments, "payments_reff_idx")).toEqual(["reffId"]);
    expect(trx.config.where).toBeDefined();
    expect(reff.config.where).toBeDefined();
  });

  it("declares the order line-item lookup index", () => {
    expect(columnNames(orderLineItems, "order_line_items_order_idx")).toEqual(["orderId"]);
  });
});
