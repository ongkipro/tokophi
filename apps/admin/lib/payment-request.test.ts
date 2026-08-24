import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import type { Sql } from "postgres";
import type { CreateOrderPaymentResult } from "./actions/payments";

type TenantRunner = <T>(
  storeId: string,
  fn: (db: PostgresJsDatabase) => Promise<T>,
) => Promise<T>;

const h = vi.hoisted(() => ({
  storeId: "",
  tenant: null as unknown as TenantRunner,
  provider: vi.fn(),
  transactionCompleted: (() => {}) as (count: number) => void,
  transactionCount: 0,
}));

// The hoisted mock must load only the schema subpath: importing @tokophi/db itself would create a
// process-global client and make the module-reload assertion observe process memory, not stored state.
vi.mock("@tokophi/db", async () => ({
  schema: await import("@tokophi/db/schema"),
}));
vi.mock("@/lib/rbac", () => ({
  requireCapability: async () => ({ storeId: h.storeId }),
}));
vi.mock("@/lib/tenant", () => ({
  withTenant: <T>(
    storeId: string,
    fn: (db: PostgresJsDatabase) => Promise<T>,
  ) => h.tenant(storeId, fn),
}));
vi.mock("@tokophi/lib/autolaris", () => ({
  autolarisConfigured: () => true,
  // AL-ORDER 2026-08-24: the action calls alCreateOrder (digital order via /api/h2h/submit) now.
  // Both names route to the same harness so the suite keeps proving request identity, not the wire.
  alCreatePayment: (input: unknown) => h.provider(input),
  alCreateOrder: (input: unknown) => h.provider(input),
}));
vi.mock("@tokophi/lib/pay-callback", () => ({
  payCallbackUrl: () => "https://example.test/pay/callback",
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const URL = process.env.TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;
let client: Sql;
let db: PostgresJsDatabase;
let createOrderPayment: (
  orderNumber: string,
  channelCode: string,
  requestKey: string,
) => Promise<CreateOrderPaymentResult>;

beforeAll(async () => {
  if (!URL) return;
  client = postgres(URL, { max: 8 });
  db = drizzle(client, { casing: "snake_case" });
  h.tenant = async <T>(
    storeId: string,
    fn: (tenantDb: PostgresJsDatabase) => Promise<T>,
  ) => {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.store_id', ${storeId}, true)`);
      await tx.execute(sql`set local role tokophi_app`);
      return fn(tx as unknown as PostgresJsDatabase);
    });
    h.transactionCount += 1;
    h.transactionCompleted(h.transactionCount);
    return result;
  };
  // Dynamic on purpose: the test reloads this exact module later and proves replay survives its cache.
  ({ createOrderPayment } = await import("./actions/payments"));
});

afterAll(async () => {
  if (client) await client.end();
});

suite("createOrderPayment durable request identity (real Postgres)", () => {
  it("coordinates one owner, rejects intent mismatch, and replays accepted and failed state after reload", async () => {
    const fixture = `pay-request-${randomUUID()}`;
    const [account] = (await db.execute(sql`
      insert into accounts (name) values (${fixture}) returning id
    `)) as unknown as { id: string }[];
    const [store] = (await db.execute(sql`
      insert into stores (account_id, name, slug)
      values (${account.id}, ${fixture}, ${fixture}) returning id
    `)) as unknown as { id: string }[];
    const [customer] = (await db.execute(sql`
      insert into customers (store_id, name, email, phone)
      values (${store.id}, 'Payment Test', 'pay@example.test', '6281234567890') returning id
    `)) as unknown as { id: string }[];
    const orderNumber = `PAY-${randomUUID()}`;
    const otherOrderNumber = `PAY-${randomUUID()}`;
    const [order] = (await db.execute(sql`
      insert into orders (store_id, customer_id, number, status, financial_status, total_idr)
      values (${store.id}, ${customer.id}, ${orderNumber}, 'baru', 'pending', 100000) returning id
    `)) as unknown as { id: string }[];
    await db.execute(sql`
      insert into orders (store_id, customer_id, number, status, financial_status, total_idr)
      values (${store.id}, ${customer.id}, ${otherOrderNumber}, 'baru', 'pending', 100000)
    `);
    h.storeId = store.id;

    try {
      h.provider.mockReset();
      const providerStarted = deferred<void>();
      const releaseProvider = deferred<void>();
      const secondClaimCommitted = deferred<void>();
      h.transactionCount = 0;
      h.transactionCompleted = (count) => {
        if (count === 2) secondClaimCommitted.resolve(undefined);
      };
      h.provider.mockImplementationOnce(async () => {
        providerStarted.resolve(undefined);
        await releaseProvider.promise;
        return {
          ok: true,
          trxId: "trx-concurrent-1",
          virtualAccount: "880012345678",
          admin: 2500,
          total: 102500,
        };
      });

      const requestKey = randomUUID();
      const first = createOrderPayment(orderNumber, "VABCA", requestKey);
      await providerStarted.promise;
      const second = createOrderPayment(orderNumber, "VABCA", requestKey);
      await secondClaimCommitted.promise;
      releaseProvider.resolve(undefined);
      const accepted = await Promise.all([first, second]);

      expect(accepted[0]).toEqual(accepted[1]);
      expect(accepted[0]).toMatchObject({ ok: true });
      if (!accepted[0].ok) {
        throw new Error(`Expected acceptance, received ${accepted[0].code}`);
      }
      expect(h.provider).toHaveBeenCalledTimes(1);
      expect(h.provider).toHaveBeenCalledWith(
        expect.objectContaining({
          reffId: requestKey,
          channelCode: "VABCA",
          amount: 100000,
        }),
      );
      const rows = (await db.execute(sql`
        select id::text as id, status::text as status, request_state::text as state
          from payments
         where order_id = ${order.id}
      `)) as unknown as { id: string; status: string; state: string }[];
      expect(rows).toEqual([
        {
          id: accepted[0].paymentId,
          status: "menunggu",
          state: "accepted",
        },
      ]);

      const channelMismatch = await createOrderPayment(
        orderNumber,
        "QRIS",
        requestKey,
      );
      expect(channelMismatch).toMatchObject({
        ok: false,
        code: "idempotency_conflict",
      });
      await db.execute(sql`
        update orders set total_idr = 110000 where id = ${order.id}
      `);
      const amountMismatch = await createOrderPayment(
        orderNumber,
        "VABCA",
        requestKey,
      );
      expect(amountMismatch).toMatchObject({
        ok: false,
        code: "idempotency_conflict",
      });
      await db.execute(sql`
        update orders set total_idr = 100000 where id = ${order.id}
      `);
      const orderMismatch = await createOrderPayment(
        otherOrderNumber,
        "VABCA",
        requestKey,
      );
      expect(orderMismatch).toMatchObject({
        ok: false,
        code: "idempotency_conflict",
      });
      expect(h.provider).toHaveBeenCalledTimes(1);

      // Reload the action module while retaining only PostgreSQL and the explicit adapter seams.
      vi.resetModules();
      ({ createOrderPayment } = await import("./actions/payments"));
      const reloadedAccepted = await createOrderPayment(
        orderNumber,
        "VABCA",
        requestKey,
      );
      expect(reloadedAccepted).toEqual(accepted[0]);
      expect(h.provider).toHaveBeenCalledTimes(1);

      h.provider.mockResolvedValueOnce({ ok: false, error: "Gateway menolak" });
      const failedKey = randomUUID();
      const failed = await createOrderPayment(
        otherOrderNumber,
        "QRIS",
        failedKey,
      );
      expect(failed).toMatchObject({
        ok: false,
        code: "request_failed",
        error: "Gateway menolak",
        terminal: true,
      });
      // A second reload proves terminal failure is replayed rather than calling the provider again.
      vi.resetModules();
      ({ createOrderPayment } = await import("./actions/payments"));
      const reloadedFailure = await createOrderPayment(
        otherOrderNumber,
        "QRIS",
        failedKey,
      );
      expect(reloadedFailure).toEqual(failed);
      expect(h.provider).toHaveBeenCalledTimes(2);
    } finally {
      h.transactionCompleted = () => {};
      // This path creates only mutable payment-request rows. It deliberately neither inserts nor
      // deletes order_financials/ledger facts, whose immutability triggers make cleanup-by-deletion
      // invalid. Child-first cleanup is therefore complete without disabling any financial guard.
      await db.execute(sql`delete from payments where store_id = ${store.id}`);
      await db.execute(sql`delete from orders where store_id = ${store.id}`);
      await db.execute(sql`delete from customers where store_id = ${store.id}`);
      await db.execute(sql`delete from stores where id = ${store.id}`);
      await db.execute(sql`delete from accounts where id = ${account.id}`);
    }
  });
});
