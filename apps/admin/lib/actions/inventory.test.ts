import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { sql, type SQL } from "drizzle-orm";
import postgres, { type Sql } from "postgres";
import { updateStock } from "./inventory";

const actionHarness = vi.hoisted(() => ({
  storeId: "",
  tx: null as unknown,
  requestedCapabilities: [] as string[],
  tenantStoreIds: [] as string[],
  revalidatedPaths: [] as string[],
  inTenantCallback: false,
}));

// A Server Action's cookie-backed auth cannot be injected directly. Keep that seam narrow: the
// action itself runs unchanged, while these two mocks supply the authenticated store and the real
// PostgreSQL transaction created below. Tests that call asTenant also use the same tokophi_app role
// and app.store_id GUC as the production withTenant wrapper.
vi.mock("@/lib/rbac", () => ({
  requireCapability: async (capability: string) => {
    actionHarness.requestedCapabilities.push(capability);
    if (capability !== "inventory:write")
      throw new Error(`unexpected capability: ${capability}`);
    return {
      userId: "inventory-action-test-user",
      storeId: actionHarness.storeId,
      role: "owner",
      email: "inventory-action@test.invalid",
      name: "Inventory Action Test",
    };
  },
}));

vi.mock("@/lib/tenant", () => ({
  withTenant: async <T>(
    storeId: string,
    fn: (db: unknown) => Promise<T>,
  ): Promise<T> => {
    actionHarness.tenantStoreIds.push(storeId);
    if (storeId !== actionHarness.storeId)
      throw new Error("action escaped its authenticated store");
    if (!actionHarness.tx) throw new Error("test transaction is not active");
    actionHarness.inTenantCallback = true;
    try {
      return await fn(actionHarness.tx);
    } finally {
      actionHarness.inTenantCallback = false;
    }
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => {
    if (actionHarness.inTenantCallback)
      throw new Error("revalidated before the stock transaction completed");
    actionHarness.revalidatedPaths.push(path);
  },
}));

const URL = process.env.TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

let client: Sql;
let db: PostgresJsDatabase;
type Db = PostgresJsDatabase;

beforeAll(() => {
  if (!URL) return;
  client = postgres(URL, { max: 1 });
  db = drizzle(client, { casing: "snake_case" });
});

afterAll(async () => {
  if (client) await client.end();
});

beforeEach(() => {
  actionHarness.storeId = "";
  actionHarness.tx = null;
  actionHarness.requestedCapabilities.length = 0;
  actionHarness.tenantStoreIds.length = 0;
  actionHarness.revalidatedPaths.length = 0;
  actionHarness.inTenantCallback = false;
});

class Rollback extends Error {}

async function inTxn(fn: (tx: Db) => Promise<void>) {
  try {
    await db.transaction(async (tx) => {
      actionHarness.tx = tx;
      await fn(tx as unknown as Db);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  } finally {
    actionHarness.tx = null;
  }
}

async function rows(tx: Db, query: SQL) {
  return (await tx.execute(query)) as unknown as Record<string, unknown>[];
}

let sequence = 0;

async function makeStore(tx: Db, label: string) {
  const suffix = ++sequence;
  const [account] = await rows(
    tx,
    sql`insert into accounts (name) values (${`Stock Action ${label}`}) returning id`,
  );
  const [store] = await rows(
    tx,
    sql`insert into stores (account_id, name, slug)
        values (${account.id}, ${`Stock Action ${label}`}, ${`stock-action-${label}-${suffix}`})
        returning id`,
  );
  const [defaultLocation] = await rows(
    tx,
    sql`insert into locations (store_id, name, is_default)
        values (${store.id}, 'Default', true) returning id`,
  );
  const [secondaryLocation] = await rows(
    tx,
    sql`insert into locations (store_id, name, is_default)
        values (${store.id}, 'Secondary', false) returning id`,
  );
  return {
    storeId: store.id as string,
    defaultLocationId: defaultLocation.id as string,
    secondaryLocationId: secondaryLocation.id as string,
  };
}

async function makeProduct(
  tx: Db,
  storeId: string,
  label: string,
  variantCount: number,
) {
  const suffix = ++sequence;
  const [product] = await rows(
    tx,
    sql`insert into products (store_id, title, handle, number, has_variants)
        values (${storeId}, ${`Stock Action ${label}`}, ${`stock-action-${label}-${suffix}`}, ${suffix}, ${variantCount > 1})
        returning id`,
  );
  const variantIds: string[] = [];
  for (let index = 0; index < variantCount; index++) {
    const [variant] = await rows(
      tx,
      sql`insert into product_variants (product_id, store_id, title, position, seq)
          values (${product.id}, ${storeId}, ${`Variant ${index + 1}`}, ${index}, ${index + 1})
          returning id`,
    );
    variantIds.push(variant.id as string);
  }
  return variantIds;
}

async function addInventory(
  tx: Db,
  variantId: string,
  locationId: string,
  available: number,
): Promise<string> {
  const [inventory] = await rows(
    tx,
    sql`insert into inventory_levels (variant_id, location_id, available)
        values (${variantId}, ${locationId}, ${available}) returning id`,
  );
  return inventory.id as string;
}

async function availableAt(tx: Db, inventoryId: string): Promise<number> {
  const [inventory] = await rows(
    tx,
    sql`select available from inventory_levels where id = ${inventoryId}`,
  );
  return Number(inventory.available);
}

async function asTenant(tx: Db, storeId: string) {
  await tx.execute(sql`select set_config('app.store_id', ${storeId}, true)`);
  await tx.execute(sql`set local role tokophi_app`);
}

suite("updateStock (real PostgreSQL)", () => {
  it("updates only the named variant at exactly the default location", async () => {
    await inTxn(async (tx) => {
      const mine = await makeStore(tx, "mine");
      const [firstVariant, siblingVariant] = await makeProduct(
        tx,
        mine.storeId,
        "mine",
        2,
      );
      const firstDefault = await addInventory(
        tx,
        firstVariant,
        mine.defaultLocationId,
        10,
      );
      const firstSecondary = await addInventory(
        tx,
        firstVariant,
        mine.secondaryLocationId,
        99,
      );
      const siblingDefault = await addInventory(
        tx,
        siblingVariant,
        mine.defaultLocationId,
        20,
      );
      actionHarness.storeId = mine.storeId;
      await asTenant(tx, mine.storeId);

      const result = await updateStock([
        { variantId: firstVariant, available: 7, expected: 10 },
      ]);

      expect(result).toEqual({
        updated: [firstVariant],
        stale: [],
        missing: [],
        invalid: [],
      });
      expect(await availableAt(tx, firstDefault)).toBe(7);
      expect(await availableAt(tx, firstSecondary)).toBe(99);
      expect(await availableAt(tx, siblingDefault)).toBe(20);
      expect(actionHarness.requestedCapabilities).toEqual(["inventory:write"]);
      expect(actionHarness.tenantStoreIds).toEqual([mine.storeId]);
      expect(actionHarness.revalidatedPaths).toEqual([
        "/produk/inventori",
        "/produk",
      ]);
    });
  });

  it("reports authoritative stale stock and never overwrites it", async () => {
    await inTxn(async (tx) => {
      const mine = await makeStore(tx, "stale");
      const [variantId] = await makeProduct(tx, mine.storeId, "stale", 1);
      const inventoryId = await addInventory(
        tx,
        variantId,
        mine.defaultLocationId,
        12,
      );
      actionHarness.storeId = mine.storeId;
      await asTenant(tx, mine.storeId);

      const result = await updateStock([
        { variantId, available: 3, expected: 11 },
      ]);

      expect(result).toEqual({
        updated: [],
        stale: [{ variantId, available: 12 }],
        missing: [],
        invalid: [],
      });
      expect(await availableAt(tx, inventoryId)).toBe(12);
    });
  });

  it("cannot mutate a wrong-store variant and rejects non-integer, negative, and non-finite quantities", async () => {
    await inTxn(async (tx) => {
      const mine = await makeStore(tx, "boundary-mine");
      const theirs = await makeStore(tx, "boundary-theirs");
      const [mineVariant] = await makeProduct(
        tx,
        mine.storeId,
        "boundary-mine",
        1,
      );
      const [theirVariant] = await makeProduct(
        tx,
        theirs.storeId,
        "boundary-theirs",
        1,
      );
      const mineInventory = await addInventory(
        tx,
        mineVariant,
        mine.defaultLocationId,
        8,
      );
      // Deliberately inconsistent child row: inventory_levels has no store_id constraint. Running this
      // case as the owner makes the explicit product_variants.store_id guard observable; RLS alone
      // would hide the foreign parent and let a missing explicit predicate pass vacuously.
      const foreignInventoryAtMine = await addInventory(
        tx,
        theirVariant,
        mine.defaultLocationId,
        31,
      );
      actionHarness.storeId = mine.storeId;

      const wrongStore = await updateStock([
        { variantId: theirVariant, available: 1, expected: 31 },
      ]);
      const fractional = await updateStock([
        { variantId: mineVariant, available: 1.5, expected: 8 },
      ]);
      const negative = await updateStock([
        { variantId: mineVariant, available: -1, expected: 8 },
      ]);
      const nonFiniteExpected = await updateStock([
        { variantId: mineVariant, available: 1, expected: Number.NaN },
      ]);
      const malformedVariant = await updateStock([
        { variantId: "not-a-uuid", available: 1, expected: 0 },
      ]);

      expect(wrongStore).toEqual({
        updated: [],
        stale: [],
        missing: [theirVariant],
        invalid: [],
      });
      expect(fractional).toEqual({
        updated: [],
        stale: [],
        missing: [],
        invalid: [mineVariant],
      });
      expect(negative.invalid).toEqual([mineVariant]);
      expect(nonFiniteExpected.invalid).toEqual([mineVariant]);
      expect(malformedVariant.invalid).toEqual(["not-a-uuid"]);
      expect(await availableAt(tx, mineInventory)).toBe(8);
      expect(await availableAt(tx, foreignInventoryAtMine)).toBe(31);
    });
  });
});
