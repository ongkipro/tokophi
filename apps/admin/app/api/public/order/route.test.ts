import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type * as ShippingQuote from "@/lib/shipping-quote";
import { verifyClaimToken } from "@tokophi/lib/claim-token";

const h = vi.hoisted(() => {
  const state = {
    beforeQuote: null as null | ((storeId: string) => Promise<void>),
  };
  const quoteShipping = vi.fn(async (input: { storeId: string }) => {
    await state.beforeQuote?.(input.storeId);
    return {
      ok: true as const,
      rates: [
        {
          name: "SPX Standard",
          code: "spx",
          type: "1",
          cost: 15_000,
          etd: "2-3 hari",
          cod: true,
          group: "regular",
        },
      ],
      grams: 500,
      billableGrams: 1_000,
      weightFallback: [],
      codEnabled: true,
      origin: 1,
      originFrom: "pickup" as const,
      originName: "Gudang Test",
    };
  });
  return { state, quoteShipping };
});

vi.mock("@/lib/data/areas", () => ({
  areaById: vi.fn(async () => ({
    id: 321,
    text: "Coblong, Kota Bandung, Jawa Barat",
    district: "Coblong",
    city: "Kota Bandung",
    province: "Jawa Barat",
  })),
  // The destination subdistrict is resolved against the district (Task 8.17). These fixtures name no
  // kelurahan, which is the ORDINARY case — the checkout only asks where the postcode is ambiguous —
  // so the honest stub is "nothing resolved" and the order stores NULL for both columns.
  resolveDestinationKelurahan: vi.fn(async () => null),
}));
vi.mock("@/lib/cod", () => ({
  getCodPolicy: vi.fn(async () => ({ reason: () => null })),
}));
vi.mock("@/lib/shipping-quote", async (importOriginal) => {
  const actual = await importOriginal<typeof ShippingQuote>();
  return { ...actual, quoteShipping: h.quoteShipping };
});

const URL = process.env.TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;
const runId = randomUUID().slice(0, 8);
const handle = `availability-${runId}`;
const discountCode = `ORDER-${runId}`;
const sessionId = `checkout-${runId}`;

let client: Sql;
let POST: (request: Request) => Promise<Response>;
let accountId = "";

type Fixture = {
  id: string;
  slug: string;
  customerId: string;
};
const fixtures: Record<string, Fixture> = {};

async function addStore(
  key: string,
  lifecycle: {
    status: "trial" | "active" | "past_due" | "suspended";
    approvedAt: Date | null;
    suspendedAt: Date | null;
  },
) {
  const slug = `order-${key}-${runId}`;
  const [store] = await client<{ id: string }[]>`
    insert into stores (
      account_id, name, slug, status, approved_at, suspended_at
    ) values (
      ${accountId}, ${`Order ${key}`}, ${slug}, ${lifecycle.status},
      ${lifecycle.approvedAt}, ${lifecycle.suspendedAt}
    ) returning id
  `;
  const [product] = await client<{ id: string }[]>`
    insert into products (store_id, title, handle, status, number)
    values (${store.id}, 'Produk Batas Toko', ${handle}, 'active', 1001)
    returning id
  `;
  const [variant] = await client<{ id: string }[]>`
    insert into product_variants (
      product_id, store_id, title, price_idr, weight_grams, position, seq
    ) values (
      ${product.id}, ${store.id}, 'Default', 100000, 500, 0, 1
    ) returning id
  `;
  const [location] = await client<{ id: string }[]>`
    insert into locations (store_id, name, is_default)
    values (${store.id}, 'Gudang Test', true)
    returning id
  `;
  await client`
    insert into inventory_levels (variant_id, location_id, available)
    values (${variant.id}, ${location.id}, 10)
  `;
  await client`
    insert into discounts (
      store_id, code, kind, value, min_purchase_idr, usage_limit, used_count, status
    ) values (${store.id}, ${discountCode}, 'nominal', 1000, 0, 10, 0, 'aktif')
  `;
  const [customer] = await client<{ id: string }[]>`
    insert into customers (store_id, name, email, phone, city, province)
    values (
      ${store.id}, 'Nama Lama', 'lama@example.test', '6281234567890',
      'Kota Lama', 'Provinsi Lama'
    ) returning id
  `;
  await client`
    insert into checkout_sessions (
      store_id, session_id, name, phone, items, status, step
    ) values (
      ${store.id}, ${sessionId}, 'Nama Lama', '6281234567890',
      ${client.json([{ handle, variant: "Default", qty: 1, price: 100000 }])},
      'aktif', 'pembayaran'
    )
  `;
  fixtures[key] = { id: store.id, slug, customerId: customer.id };
}

async function mutationState(storeId: string) {
  const [
    checkoutSessions,
    customers,
    orders,
    orderLines,
    orderFinancials,
    payments,
    inventory,
    discounts,
    discountUsages,
    trackingDeliveries,
  ] = await Promise.all([
    client`
      select session_id, status::text, customer_id, recovered_order_id,
             recovered_at, updated_at
        from checkout_sessions
       where store_id = ${storeId}
       order by id
    `,
    client`
      select id, name, email, phone, city, province
        from customers
       where store_id = ${storeId}
       order by id
    `,
    client`
      select id, number, customer_id, subtotal_idr, discount_idr,
             shipping_idr, tax_idr, total_idr
        from orders
       where store_id = ${storeId}
       order by id
    `,
    client`
      select li.id, li.order_id, li.variant_id, li.qty, li.price_idr, li.total_idr
        from order_line_items li
        join orders o on o.id = li.order_id
       where o.store_id = ${storeId}
       order by li.id
    `,
    client`
      select f.id, f.order_id, f.order_payable_idr
        from order_financials f
       where f.store_id = ${storeId}
       order by f.id
    `,
    client`
      select id, order_id, method::text, status::text, amount_idr, total
        from payments
       where store_id = ${storeId}
       order by id
    `,
    client`
      select il.id, il.available
        from inventory_levels il
        join product_variants v on v.id = il.variant_id
       where v.store_id = ${storeId}
       order by il.id
    `,
    client`
      select id, used_count
        from discounts
       where store_id = ${storeId}
       order by id
    `,
    client`
      select u.id, u.discount_id, u.order_id
        from discount_usages u
        join discounts d on d.id = u.discount_id
       where d.store_id = ${storeId}
       order by u.id
    `,
    client`
      select id, order_id, channel::text, event_name, event_id, status::text
        from tracking_event_deliveries
       where store_id = ${storeId}
       order by id
    `,
  ]);

  return {
    checkoutSessions: [...checkoutSessions],
    customers: [...customers],
    orders: [...orders],
    orderLines: [...orderLines],
    orderFinancials: [...orderFinancials],
    payments: [...payments],
    inventory: [...inventory],
    discounts: [...discounts],
    discountUsages: [...discountUsages],
    trackingDeliveries: [...trackingDeliveries],
  };
}

function orderRequest(key: string) {
  const fixture = fixtures[key]!;
  return new Request("http://localhost/api/public/order", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.42",
    },
    body: JSON.stringify({
      storeSlug: fixture.slug,
      sessionId,
      items: [
        {
          handle,
          name: "Nama dari browser diabaikan",
          variant: "Default",
          qty: 1,
          price: 100000,
        },
      ],
      customer: {
        name: "Budi Santoso",
        phone: "0812 3456 7890",
        email: "budi@example.test",
      },
      address: {
        alamat: "Jl. Merdeka No. 10, RT 01/RW 02",
        kota: "klaim browser",
        provinsi: "klaim browser",
        kodepos: "40123",
      },
      shipping: {
        service: "spx",
        serviceType: "1",
        destId: 321,
      },
      channelCode: "cod",
      discountCode,
    }),
  });
}

beforeAll(async () => {
  if (!URL) return;
  process.env.DATABASE_URL = URL;
  client = postgres(URL, { max: 1 });
  // The route owns a module-level database pool, so it must be loaded only after DATABASE_URL points
  // at the isolated test database. A static import would connect during module evaluation too early.
  ({ POST } = await import("./route"));

  const [account] = await client<{ id: string }[]>`
    insert into accounts (name) values (${`Order availability ${runId}`}) returning id
  `;
  accountId = account.id;
  const lockedAt = new Date("2026-08-18T00:00:00.000Z");
  const approvedAt = new Date("2026-08-01T00:00:00.000Z");
  await addStore("active", {
    status: "active",
    approvedAt,
    suspendedAt: null,
  });
  await addStore("pending", {
    status: "trial",
    approvedAt: null,
    suspendedAt: lockedAt,
  });
  // Deliberately leave the denormalized status active: suspended_at is the public lock.
  await addStore("suspended", {
    status: "active",
    approvedAt,
    suspendedAt: lockedAt,
  });
  await addStore("race", {
    status: "active",
    approvedAt,
    suspendedAt: null,
  });
});

beforeEach(() => {
  h.state.beforeQuote = null;
  h.quoteShipping.mockClear();
});

afterAll(async () => {
  if (!client || !accountId) return;
  await client.begin(async (sql) => {
    // Test-only cleanup: immutable financial rows deliberately reject ordinary DELETE.
    await sql`set local session_replication_role = 'replica'`;
    await sql`
      delete from ledger_entries
       where store_id in (select id from stores where account_id = ${accountId})
    `;
    await sql`
      delete from tracking_event_deliveries
       where store_id in (select id from stores where account_id = ${accountId})
    `;
    await sql`
      delete from discount_usages u using discounts d
       where u.discount_id = d.id
         and d.store_id in (select id from stores where account_id = ${accountId})
    `;
    await sql`
      delete from fulfillments f using orders o
       where f.order_id = o.id
         and o.store_id in (select id from stores where account_id = ${accountId})
    `;
    await sql`
      delete from shipment_bookings
       where store_id in (select id from stores where account_id = ${accountId})
    `;
    await sql`
      delete from payments
       where store_id in (select id from stores where account_id = ${accountId})
    `;
    await sql`
      delete from order_financials
       where store_id in (select id from stores where account_id = ${accountId})
    `;
    await sql`
      delete from order_line_items li using orders o
       where li.order_id = o.id
         and o.store_id in (select id from stores where account_id = ${accountId})
    `;
    await sql`
      delete from checkout_sessions
       where store_id in (select id from stores where account_id = ${accountId})
    `;
    await sql`
      delete from orders
       where store_id in (select id from stores where account_id = ${accountId})
    `;
    await sql`
      delete from customer_addresses a using customers c
       where a.customer_id = c.id
         and c.store_id in (select id from stores where account_id = ${accountId})
    `;
    await sql`
      delete from customers
       where store_id in (select id from stores where account_id = ${accountId})
    `;
    await sql`
      delete from inventory_levels il using product_variants v
       where il.variant_id = v.id
         and v.store_id in (select id from stores where account_id = ${accountId})
    `;
    await sql`
      delete from product_variants
       where store_id in (select id from stores where account_id = ${accountId})
    `;
    await sql`
      delete from products
       where store_id in (select id from stores where account_id = ${accountId})
    `;
    await sql`
      delete from locations
       where store_id in (select id from stores where account_id = ${accountId})
    `;
    await sql`
      delete from discounts
       where store_id in (select id from stores where account_id = ${accountId})
    `;
    await sql`delete from stores where account_id = ${accountId}`;
    await sql`delete from accounts where id = ${accountId}`;
  });
  await client.end();
});

suite("POST /api/public/order — public store availability", () => {
  it("keeps the active-store order flow reachable through every persisted mutation", async () => {
    const fixture = fixtures.active!;
    const before = await mutationState(fixture.id);

    const response = await POST(orderRequest("active"));
    const payload = await response.json();
    const after = await mutationState(fixture.id);

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(payload).toMatchObject({ ok: true, cod: true });
    expect(payload).not.toHaveProperty("claimToken"); // ACCOUNT_CLAIM_SECRET unset → feature off
    expect(h.quoteShipping).toHaveBeenCalledTimes(1);
    expect(after.checkoutSessions).toEqual([
      expect.objectContaining({
        status: "pulih",
        customer_id: fixture.customerId,
        recovered_order_id: expect.any(String),
        recovered_at: expect.any(Date),
      }),
    ]);
    expect(after.customers).toEqual([
      expect.objectContaining({
        id: fixture.customerId,
        name: "Budi Santoso",
        email: "budi@example.test",
        city: "Kota Bandung",
        province: "Jawa Barat",
      }),
    ]);
    expect(after.orders).toHaveLength(before.orders.length + 1);
    expect(after.orderLines).toHaveLength(before.orderLines.length + 1);
    expect(after.orderFinancials).toHaveLength(
      before.orderFinancials.length + 1,
    );
    expect(after.payments).toHaveLength(before.payments.length + 1);
    expect(after.discountUsages).toHaveLength(
      before.discountUsages.length + 1,
    );
    expect(after.inventory[0].available).toBe(
      before.inventory[0].available - 1,
    );
    expect(after.discounts[0].used_count).toBe(
      before.discounts[0].used_count + 1,
    );
    expect(after.trackingDeliveries).toEqual(before.trackingDeliveries);
  });

  it.each([
    { key: "pending", label: "pending/unapproved" },
    { key: "suspended", label: "suspended" },
  ])(
    "returns the public not-found response and leaves every mutation target unchanged for a $label store",
    async ({ key }) => {
      const fixture = fixtures[key]!;
      const before = await mutationState(fixture.id);

      const response = await POST(orderRequest(key));

      expect(response.status).toBe(404);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(await response.json()).toEqual({
        ok: false,
        error: "Toko tidak ditemukan.",
      });
      expect(h.quoteShipping).not.toHaveBeenCalled();
      expect(await mutationState(fixture.id)).toEqual(before);
    },
  );

  // ── Task 4.8: one checkout session buys at most once, and the DATABASE is what says so ────────
  //
  // The route already refused a resubmitted checkout — with a PREFLIGHT READ taken before the write
  // transaction opens. Two submissions racing (a double tap, a retried request, a connection the
  // browser retries on the shopper's behalf) both read "no order yet", both passed, and both wrote:
  // the buyer billed twice and the stock decremented twice. `orders_one_per_checkout_session`
  // (migration 0097) is the rule; the read is only an early exit.
  //
  // Fired through the REAL handler against real Postgres, concurrently, because the claim is about
  // what two transactions do to each other — the one thing a sequential test cannot observe.
  it("two concurrent submissions of one checkout produce ONE order and ONE decrement", async () => {
    const key = "concurrent";
    await addStore(key, { status: "active", approvedAt: new Date(), suspendedAt: null });
    const fixture = fixtures[key]!;
    const before = await mutationState(fixture.id);

    const [a, b] = await Promise.all([
      POST(orderRequest(key)),
      POST(orderRequest(key)),
    ]);
    const [bodyA, bodyB] = await Promise.all([a.json(), b.json()]);
    const after = await mutationState(fixture.id);

    // ONE order, whichever request won.
    expect(after.orders.length, JSON.stringify({ bodyA, bodyB })).toBe(1);
    const created = after.orders[0]!;

    // ONE decrement: the loser's whole transaction rolled back, so it moved no stock.
    const stockBefore = Number(before.inventory[0]?.available ?? 0);
    const stockAfter = Number(after.inventory[0]?.available ?? 0);
    expect(stockBefore - stockAfter).toBe(1);

    // A STABLE IDENTITY: both callers are told about the same order — one as the creator, the other
    // as a duplicate — and neither is left holding a number that does not exist.
    const numbers = [bodyA, bodyB]
      .map((body) => (body as { orderNumber?: string }).orderNumber)
      .filter(Boolean);
    expect(numbers).toHaveLength(2);
    expect(new Set(numbers).size, "both callers must name the same order").toBe(1);
    expect(numbers[0]).toBe(created.number);

    // Exactly one of the two is the duplicate answer, and it says so in a code the storefront can act on.
    const codes = [bodyA, bodyB].map((body) => (body as { code?: string }).code);
    expect(codes.filter((code) => code === "order_already_created")).toHaveLength(1);
  }, 60_000);

  // Retry after the fact — the same session submitted again, long after the first order committed.
  // This is the path the preflight already covered; it must keep working, because the constraint
  // makes the preflight redundant rather than wrong.
  it("a later resubmission of the same checkout is refused with the same order", async () => {
    const key = "replay";
    await addStore(key, { status: "active", approvedAt: new Date(), suspendedAt: null });
    const fixture = fixtures[key]!;

    const first = await POST(orderRequest(key));
    const firstBody = (await first.json()) as { orderNumber?: string };
    const second = await POST(orderRequest(key));
    const secondBody = (await second.json()) as { orderNumber?: string; code?: string };

    const after = await mutationState(fixture.id);
    expect(after.orders.length).toBe(1);
    expect(secondBody.code).toBe("order_already_created");
    expect(secondBody.orderNumber).toBe(firstBody.orderNumber);
  }, 60_000);

  // Task 10.13 (spec §17 D-3): with ACCOUNT_CLAIM_SECRET set, the SUCCESS answer carries a claim
  // token bound to the created order; the duplicate answer (reachable by replaying a session id) does not.
  it("issues a claim token for the created order on success only", async () => {
    const secret = "t".repeat(40);
    vi.stubEnv("ACCOUNT_CLAIM_SECRET", secret);
    try {
      const key = "claim";
      await addStore(key, { status: "active", approvedAt: new Date(), suspendedAt: null });
      const fixture = fixtures[key]!;

      const first = await POST(orderRequest(key));
      const firstBody = (await first.json()) as { ok?: boolean; orderNumber?: string; claimToken?: string };
      const [created] = (await mutationState(fixture.id)).orders as { id: string; number: string }[];
      expect(firstBody).toMatchObject({ ok: true, orderNumber: created.number });
      expect(verifyClaimToken(firstBody.claimToken!, secret, Date.now(), created.id)).not.toBeNull();

      const replay = (await (await POST(orderRequest(key))).json()) as Record<string, unknown>;
      expect(replay.code).toBe("order_already_created");
      expect(replay).not.toHaveProperty("claimToken");
    } finally {
      vi.unstubAllEnvs();
    }
  }, 60_000);

  it("re-checks the store lock inside the transaction before the customer upsert", async () => {
    const fixture = fixtures.race!;
    const before = await mutationState(fixture.id);
    h.state.beforeQuote = async (storeId) => {
      expect(storeId).toBe(fixture.id);
      await client`
        update stores
           set suspended_at = ${new Date("2026-08-18T01:00:00.000Z")}
         where id = ${fixture.id}
      `;
    };

    const response = await POST(orderRequest("race"));

    expect(response.status).toBe(404);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(await response.json()).toEqual({
      ok: false,
      error: "Toko tidak ditemukan.",
    });
    expect(h.quoteShipping).toHaveBeenCalledTimes(1);
    expect(await mutationState(fixture.id)).toEqual(before);
  });
});
