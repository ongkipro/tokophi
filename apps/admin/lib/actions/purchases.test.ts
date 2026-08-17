import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres, { type Sql } from "postgres";
import { createPurchaseOrder } from "./purchases";

const h = vi.hoisted(() => ({
  storeId: "",
  tenant: null as unknown as <T>(
    storeId: string,
    fn: (db: PostgresJsDatabase) => Promise<T>,
  ) => Promise<T>,
  revalidatedPaths: [] as string[],
}));

vi.mock("@tokophi/db", async () => ({
  schema: await import("@tokophi/db/schema"),
}));
vi.mock("@/lib/rbac", () => ({
  requireCapability: async (capability: string) => {
    if (capability !== "purchases:write")
      throw new Error(`unexpected capability: ${capability}`);
    return { storeId: h.storeId };
  },
}));
vi.mock("@/lib/tenant", () => ({
  withTenant: <T>(
    storeId: string,
    fn: (db: PostgresJsDatabase) => Promise<T>,
  ) => h.tenant(storeId, fn),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => h.revalidatedPaths.push(path),
}));

const URL = process.env.TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;
let client: Sql;
let db: PostgresJsDatabase;

beforeAll(() => {
  if (!URL) return;
  client = postgres(URL, { max: 8 });
  db = drizzle(client, { casing: "snake_case" });
  h.tenant = async <T>(
    storeId: string,
    fn: (tenantDb: PostgresJsDatabase) => Promise<T>,
  ) =>
    db.transaction(async (tx) => {
      if (storeId !== h.storeId)
        throw new Error("action escaped its authenticated store");
      await tx.execute(sql`select set_config('app.store_id', ${storeId}, true)`);
      await tx.execute(sql`set local role tokophi_app`);
      return fn(tx as unknown as PostgresJsDatabase);
    });
});

afterAll(async () => {
  if (client) await client.end();
});

type Fixture = {
  accountId: string;
  storeId: string;
  supplierId: string;
  supplierName: string;
  productId: string;
  variantId: string;
};

async function makeFixture(label: string): Promise<Fixture> {
  const token = randomUUID();
  const [account] = (await db.execute(sql`
    insert into accounts (name) values (${`Purchase ${label}`}) returning id
  `)) as unknown as { id: string }[];
  const [store] = (await db.execute(sql`
    insert into stores (account_id, name, slug)
    values (${account.id}, ${`Purchase ${label}`}, ${`purchase-${token}`}) returning id
  `)) as unknown as { id: string }[];
  const supplierName = `Supplier ${label} ${token}`;
  const [supplier] = (await db.execute(sql`
    insert into suppliers (store_id, name)
    values (${store.id}, ${supplierName}) returning id
  `)) as unknown as { id: string }[];
  const [product] = (await db.execute(sql`
    insert into products (store_id, title, handle, number, has_variants)
    values (${store.id}, ${`Product ${label}`}, ${`product-${token}`}, 1, false)
    returning id
  `)) as unknown as { id: string }[];
  const [variant] = (await db.execute(sql`
    insert into product_variants (product_id, store_id, title, position, seq)
    values (${product.id}, ${store.id}, 'Default', 0, 1) returning id
  `)) as unknown as { id: string }[];
  return {
    accountId: account.id,
    storeId: store.id,
    supplierId: supplier.id,
    supplierName,
    productId: product.id,
    variantId: variant.id,
  };
}

async function cleanupFixture(fixture: Fixture) {
  await db.execute(sql`
    delete from purchase_order_items
    where purchase_order_id in (
      select id from purchase_orders where store_id = ${fixture.storeId}
    )
  `);
  await db.execute(
    sql`delete from purchase_orders where store_id = ${fixture.storeId}`,
  );
  await db.execute(sql`delete from suppliers where id = ${fixture.supplierId}`);
  await db.execute(
    sql`delete from product_variants where id = ${fixture.variantId}`,
  );
  await db.execute(sql`delete from products where id = ${fixture.productId}`);
  await db.execute(sql`delete from stores where id = ${fixture.storeId}`);
  await db.execute(sql`delete from accounts where id = ${fixture.accountId}`);
}

async function purchaseRows(storeId: string) {
  return (await db.execute(sql`
    select po.id, po.code, poi.variant_id, poi.qty, poi.cost_idr
    from purchase_orders po
    join purchase_order_items poi on poi.purchase_order_id = po.id
    where po.store_id = ${storeId}
  `)) as unknown as {
    id: string;
    code: string;
    variant_id: string;
    qty: number;
    cost_idr: string;
  }[];
}

suite("createPurchaseOrder (real PostgreSQL)", () => {
  it("creates one PO and line for concurrent repeats and rejects request reuse with different intent", async () => {
    const fixture = await makeFixture("idempotency");
    h.storeId = fixture.storeId;
    h.revalidatedPaths.length = 0;
    const requestKey = randomUUID();
    const input = {
      requestKey,
      supplier: fixture.supplierName.toUpperCase(),
      etaDate: "2026-08-25",
      note: "Restock",
      lines: [{ variantId: fixture.variantId, qty: 7, cost: 42_000 }],
    };

    try {
      const rejectedInputs = [
        {
          requestKey: null,
          supplier: fixture.supplierName,
          lines: [{ variantId: fixture.variantId, qty: 1, cost: 1 }],
        },
        {
          requestKey,
          supplier: fixture.supplierName,
          lines: [null],
        },
        {
          ...input,
          lines: [
            {
              variantId: fixture.variantId,
              qty: Number.MAX_SAFE_INTEGER,
              cost: 2,
            },
          ],
        },
      ];
      for (const rejectedInput of rejectedInputs) {
        await expect(
          createPurchaseOrder(rejectedInput as never),
        ).resolves.toMatchObject({ ok: false, code: "invalid_request" });
      }
      expect(await purchaseRows(fixture.storeId)).toEqual([]);

      const [first, second] = await Promise.all([
        createPurchaseOrder(input),
        createPurchaseOrder(input),
      ]);
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      if (!first.ok || !second.ok) throw new Error("expected accepted results");
      expect(first.purchaseOrderId).toBe(second.purchaseOrderId);
      expect(first.code).toBe(second.code);
      expect([first.replayed, second.replayed].sort()).toEqual([false, true]);

      const replay = await createPurchaseOrder(input);
      expect(replay).toMatchObject({
        ok: true,
        purchaseOrderId: first.purchaseOrderId,
        code: first.code,
        replayed: true,
      });
      await expect(
        createPurchaseOrder({
          ...input,
          lines: [{ ...input.lines[0], qty: 8 }],
        }),
      ).resolves.toMatchObject({ ok: false, code: "idempotency_conflict" });

      expect(await purchaseRows(fixture.storeId)).toEqual([
        expect.objectContaining({
          id: first.purchaseOrderId,
          code: first.code,
          variant_id: fixture.variantId,
          qty: 7,
          cost_idr: "42000",
        }),
      ]);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("rejects unowned inputs and rolls back the PO when item insertion fails", async () => {
    const fixture = await makeFixture("failure");
    const foreign = await makeFixture("foreign");
    h.storeId = fixture.storeId;
    const token = randomUUID().replaceAll("-", "");
    const functionName = `test_fail_po_item_${token}`;
    const triggerName = `test_fail_po_item_${token}`;
    const failingCost = 987_654_321;

    try {
      await expect(
        createPurchaseOrder({
          requestKey: randomUUID(),
          supplier: fixture.supplierName,
          lines: [{ variantId: foreign.variantId, qty: 1, cost: 1 }],
        }),
      ).resolves.toMatchObject({ ok: false, code: "variant_not_found" });
      await expect(
        createPurchaseOrder({
          requestKey: randomUUID(),
          supplier: "Missing supplier",
          lines: [{ variantId: fixture.variantId, qty: 1, cost: 1 }],
        }),
      ).resolves.toMatchObject({ ok: false, code: "supplier_not_found" });

      await client.unsafe(`
        create function "${functionName}"() returns trigger language plpgsql as $$
        begin
          if new.cost_idr = ${failingCost} then
            raise exception 'injected purchase item failure';
          end if;
          return new;
        end
        $$
      `);
      await client.unsafe(`
        create trigger "${triggerName}"
        before insert on purchase_order_items
        for each row execute function "${functionName}"()
      `);
      const requestKey = randomUUID();
      await expect(
        createPurchaseOrder({
          requestKey,
          supplier: fixture.supplierName,
          lines: [
            { variantId: fixture.variantId, qty: 1, cost: failingCost },
          ],
        }),
      ).resolves.toEqual({
        ok: false,
        code: "save_failed",
        error: "Pesanan gagal disimpan. Periksa data lalu coba lagi.",
      });
      expect(await purchaseRows(fixture.storeId)).toEqual([]);
    } finally {
      await client.unsafe(
        `drop trigger if exists "${triggerName}" on purchase_order_items`,
      );
      await client.unsafe(`drop function if exists "${functionName}"()`);
      await cleanupFixture(fixture);
      await cleanupFixture(foreign);
    }
  });
});
