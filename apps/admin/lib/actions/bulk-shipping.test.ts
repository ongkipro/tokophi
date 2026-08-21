import { describe, expect, it, vi, beforeEach } from "vitest";

// Pengiriman Massal — the per-run ceiling, and the orders it used to swallow.
//
// `bulkGenerateResi`/`bulkFetchResi` apply `numbers.slice(0, 50)`. The list page loads up to 200
// rows and the button posts the WHOLE selection (`canBook.map(...)`, label "Generate resi (N)"), so
// a seller selecting 150 orders got `{ ok: true, done: 50 }` — and orders 51..150 appeared in
// `done`, in `failed` and in `awaitingResi` exactly nowhere. Green result, 100 parcels never booked,
// nothing on screen naming them. `tsc` cannot see a dropped array tail.
//
// No database and no network: the ceiling is pure arithmetic over the argument, and the point is
// what the RESULT says. The single-order actions this loop orchestrates are mocked so the run is
// deterministic — every order "succeeds" — which is what makes the missing tail the only variable.

const h = vi.hoisted(() => ({
  booked: [] as string[],
  tracked: [] as string[],
}));

vi.mock("@/lib/rbac", () => ({
  requireCapability: async () => ({ storeId: "store-under-test" }),
}));
// The only thing the loop reads through `withTenant` is `orderService()` — the order's stored
// courier + service_type. A chainable stub ending in that one row keeps the booking path real
// without a database; the ceiling under test is arithmetic over the argument, not SQL.
const orderRow = [{ courier: "spx", serviceType: "1" }];
const chain: Record<string, unknown> = {};
for (const m of ["select", "from", "where"]) chain[m] = () => chain;
chain.limit = async () => orderRow;
vi.mock("@/lib/tenant", () => ({
  withTenant: async <T,>(_storeId: string, fn: (db: unknown) => Promise<T>) => fn(chain),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@tokophi/db", async () => ({ schema: await import("@tokophi/db/schema") }));
vi.mock("@/lib/actions/shipping", () => ({
  getShippingRates: async () => ({
    ok: true as const,
    rates: [{ code: "spx", type: "1", service: "SPX Standard", cost: 15_000, cod: true }],
  }),
  createShipment: async ({ orderNumber }: { orderNumber: string }) => {
    h.booked.push(orderNumber);
    return { ok: true as const, awb: "SPX" + orderNumber };
  },
  trackShipment: async (number: string) => {
    h.tracked.push(number);
    return { ok: true as const, awb: "SPX" + number };
  },
}));

const { bulkGenerateResi, bulkFetchResi } = await import("./bulk-shipping");

// The loop reads `orders.courier`/`service_type` back through `withTenant`, which is mocked above,
// so the drizzle builder is never reached — the module's own `orderService` is stubbed here instead.
vi.mock("drizzle-orm", async (orig) => ({ ...(await orig<object>()) }));

const nums = (n: number) => Array.from({ length: n }, (_, i) => `INV-${1000 + i}`);

beforeEach(() => {
  h.booked = [];
  h.tracked = [];
});

describe("a bulk run names every order it did NOT attempt", () => {
  it("bulkFetchResi: 60 selected → 50 attempted, 10 reported as skipped, ok:false", async () => {
    const r = await bulkFetchResi(nums(60));
    expect(h.tracked.length).toBe(50);
    // The shipped code returned { ok: true, done: 50, failed: [], awaitingResi: [] } — the last ten
    // orders were named in no field at all.
    expect(r.skipped).toEqual(nums(60).slice(50));
    expect(r.done + r.failed.length + r.awaitingResi.length + r.skipped.length).toBe(60);
    expect(r.ok).toBe(false);
  });

  it("bulkFetchResi: a selection inside the ceiling still reports ok with nothing skipped", async () => {
    const r = await bulkFetchResi(nums(50));
    expect(h.tracked.length).toBe(50);
    expect(r.skipped).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("bulkGenerateResi: the same ceiling, and it BOOKS only the 50 it reports", async () => {
    const r = await bulkGenerateResi(nums(150));
    // Every unattempted order must be accounted for — a bulk BOOKING run is where a silently
    // dropped tail becomes a hundred parcels that never leave the shop.
    expect(r.skipped.length).toBe(100);
    expect(h.booked.length + r.skipped.length).toBe(150);
    expect(r.ok).toBe(false);
  });
});
