import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { codeOnly } from "../../../../../../test/source-code";

// Task 8.24 (finance audit 2026-09-16, F1) — the renewal invoice the cron creates.
//
// The cron used to build its own bill: `alCreatePayment` with `channelCode: "BCA"`, a code the
// provider has never known. The provider refused, `r.ok` was false, and NO invoice row was written,
// with nothing logged — a lapsed store sat `past_due → suspended` with nothing to pay, while the
// sweep reported a green `invoicesCreated: 0`. It had never been exercised: production has never
// had a `past_due` store while the gateway was configured. This drives the REAL route against real
// Postgres with the provider stubbed at the module boundary, so the claim is about what lands in
// `invoices`, not about a mock agreeing with itself.

const URL_ = process.env.TEST_DATABASE_URL;
const suite = URL_ ? describe : describe.skip;
const runId = randomUUID().slice(0, 8);
const SECRET = `cron-${runId}`;

const provider = vi.fn(async (input: { reffId: string; channelCode: string; amount: number; customerEmail: string }) => ({
  ok: true as const,
  trxId: `TRX-${input.reffId}`,
  virtualAccount: "8808123456",
  amount: input.amount,
  total: input.amount,
}));
vi.mock("@tokophi/lib/autolaris", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, autolarisConfigured: () => true, alCreateOrder: (i: never) => provider(i) };
});

let client: Sql;
let GET: (req: NextRequest) => Promise<Response>;
let accountId = "";
const stores: string[] = [];

const tick = () => GET(new NextRequest("http://admin.test/api/cron/billing?every=86400", { headers: { "x-cron-secret": SECRET } }));

async function store(opts: { periodEnd: Date | null; comped?: boolean; firstPaid?: boolean }) {
  const [s] = await client<{ id: string }[]>`
    insert into stores (account_id, name, slug, status, trial_ends_at, current_period_end, first_invoice_paid, comped, approved_at)
    values (${accountId}, ${`Cron ${runId}`}, ${`c${runId}-${stores.length}`}, 'active', now() - interval '40 days',
            ${opts.periodEnd}, ${opts.firstPaid ?? true}, ${opts.comped ?? false}, now())
    returning id`;
  stores.push(s.id);
  return s.id;
}
const invoices = (storeId: string) =>
  client<{ amount_idr: string; tax_idr: string; channel: string | null; status: string; cycle: string | null }[]>`
    select amount_idr, tax_idr, channel, status, cycle from invoices where store_id = ${storeId} order by issued_at`;

beforeAll(async () => {
  if (!URL_) return;
  process.env.DATABASE_URL = URL_;
  process.env.CRON_SECRET = SECRET;
  process.env.AUTOLARIS_API_KEY = "test";
  client = postgres(URL_, { max: 2 });
  ({ GET } = await import("./route"));
  const [acc] = await client<{ id: string }[]>`insert into accounts (name) values (${`Cron ${runId}`}) returning id`;
  accountId = acc.id;
  // The global PPN toggle: OFF, like production (owner ruling 2026-08-24). Restored in afterAll.
  await client`insert into platform_finance (id, subscription_ppn_enabled) values (1, false) on conflict (id) do update set subscription_ppn_enabled = false`;
});

afterAll(async () => {
  if (!client) return;
  try {
    for (const id of stores) {
      await client`delete from invoices where store_id = ${id}`;
      await client`delete from platform_activity where store_id = ${id}`;
      await client`delete from stores where id = ${id}`;
    }
    await client`delete from accounts where id = ${accountId}`;
  } finally {
    await client.end();
  }
});

suite("cron/billing — the renewal invoice (Task 8.24)", { timeout: 120_000 }, () => {
  it("creates exactly ONE invoice for a past_due store, on a REAL channel code, at the quoted price with the stored tax", async () => {
    const id = await store({ periodEnd: new Date(Date.now() - 86_400_000) }); // lapsed yesterday → past_due (3-day grace)
    provider.mockClear();
    const res = await tick();
    expect(res.status).toBe(200);
    const rows = await invoices(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ channel: "VABCA", status: "menunggu", cycle: "monthly" });
    expect(Number(rows[0].amount_idr)).toBe(275_000); // first invoice already paid → the regular price
    expect(Number(rows[0].tax_idr)).toBe(0); // toggle off → no PPN line
    // The slug is kept under 12 chars: the reference embeds `slug.slice(0, 12)`, so a longer one
    // would be cut and the call could never be matched (the first draft's `cron-<8>-0` was 13).
    const call = provider.mock.calls.find((c) => c[0].reffId.includes(`c${runId}-0`));
    expect(call?.[0].channelCode).toBe("VABCA");
    expect(call?.[0].amount).toBe(275_000);
  });

  it("a second tick reuses the pending invoice — never a duplicate bill", async () => {
    const id = stores[0];
    provider.mockClear();
    await tick();
    expect(await invoices(id)).toHaveLength(1);
    expect(provider.mock.calls.filter((c) => c[0].reffId.includes(`c${runId}-0`))).toHaveLength(0);
  });

  it("a comped (VIP) store is never billed", async () => {
    const id = await store({ periodEnd: new Date(Date.now() - 86_400_000), comped: true });
    await tick();
    expect(await invoices(id)).toHaveLength(0);
  });

  it("a store inside its paid period is not billed", async () => {
    const id = await store({ periodEnd: new Date(Date.now() + 10 * 86_400_000) });
    await tick();
    expect(await invoices(id)).toHaveLength(0);
  });

  it("the promo price applies to a store whose first invoice was never paid", async () => {
    const id = await store({ periodEnd: new Date(Date.now() - 86_400_000), firstPaid: false });
    await tick();
    const rows = await invoices(id);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].amount_idr)).toBe(50_000);
  });
});

// The regression itself, as a source claim: the cron must not build a bill of its own again.
describe("cron/billing source — one creator, no private bill", () => {
  const src = codeOnly(readFileSync(fileURLToPath(new URL("./route.ts", import.meta.url)), "utf8"));
  it("calls createSubscriptionInvoice and never alCreatePayment, and carries no bank nickname", () => {
    expect(src).toMatch(/createSubscriptionInvoice\s*\(/);
    expect(src).not.toMatch(/alCreatePayment/);
    expect(src).not.toMatch(/insert\s*\(\s*schema\s*\.\s*invoices\s*\)/);
    // `"BCA"` was the bug; the scanner inerts string contents, so the claim is on the constant.
    expect(src).toMatch(/const\s+RENEWAL_CHANNEL\s*=/);
  });
});
