import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { holdPlatformFinance } from "../../../test/platform-finance-lock";

// BILL-PRICE-2026-11 / ADR 0020 — what `createSubscriptionInvoice` (THE one creator: cron, merchant,
// Super Admin) actually WRITES to `invoices`, against real Postgres with the payment provider stubbed.
//
//   no code              → monthly 178.500 · annual 1.713.600 (13 months straight from trial)
//   code with Rp100.000  → FIRST paid invoice 78.500 / 1.613.600, every later one normal
//   never twice          → pending reused; a manual "Lunas" consumes it; a cancelled one gives it back;
//                          two LIVE discounted invoices are a DB impossibility (0119), also under a race
//   existing stores      → an invoice issued at the old price keeps its amount; the next one is new-price
//   PPN on vs off        → PPN on the DISCOUNTED DPP; amount_idr and tax_idr both stored
//   provider-only code   → discount 0, normal price
//
// Nothing reaches a payment provider: `provider` is the creator's injected seam.

const URL_ = process.env.TEST_DATABASE_URL;
const suite = URL_ ? describe : describe.skip;
const run = randomUUID().slice(0, 6).toUpperCase();

type Creator = typeof import("./subscription-invoice");
let si: Creator;
let client: Sql;
let finance: Awaited<ReturnType<typeof holdPlatformFinance>>;
let accountId = "";
const stores: string[] = [];
const codes: string[] = [];

let providerDelayMs = 0;
const provider = vi.fn(async (input: { reffId: string; amount: number }) => {
  if (providerDelayMs) await new Promise((r) => setTimeout(r, providerDelayMs));
  return { ok: true as const, trxId: `TRX-${input.reffId}-${randomUUID().slice(0, 4)}`, virtualAccount: "8808000000", amount: input.amount, total: input.amount };
});

async function code(discount: number, provider_ = "kiriminaja") {
  const c = `T${run}-${codes.length}D${discount}`.slice(0, 32);
  await client`insert into signup_codes (code, shipping_provider, discount_first_invoice_idr) values (${c}, ${provider_}, ${discount})`;
  codes.push(c);
  return c;
}

async function store(opts: { code?: string | null; firstPaid?: boolean; comped?: boolean } = {}) {
  const [s] = await client<{ id: string }[]>`
    insert into stores (account_id, name, slug, status, trial_ends_at, current_period_end, first_invoice_paid, comped, approved_at, signup_code)
    values (${accountId}, ${`Harga ${run}`}, ${`h${run.toLowerCase()}-${stores.length}`}, 'trial', now() - interval '1 day', null,
            ${opts.firstPaid ?? false}, ${opts.comped ?? false}, now(), ${opts.code ?? null})
    returning id`;
  stores.push(s.id);
  return s.id;
}

const bill = (storeId: string, cycle: "monthly" | "annual" = "monthly") =>
  si.createSubscriptionInvoice({ storeId, cycle, channelCode: "VABCA", actor: "merchant", provider: provider as never });

type Row = { number: string; amount_idr: string; tax_idr: string; code_discount_idr: string; discount_code: string | null; status: string; cycle: string; period_months: number };
const rows = (storeId: string) =>
  client<Row[]>`select number, amount_idr, tax_idr, code_discount_idr, discount_code, status, cycle, period_months
                from invoices where store_id = ${storeId} order by issued_at, number`;
const money = (r: Row) => ({ amount: Number(r.amount_idr), tax: Number(r.tax_idr), discount: Number(r.code_discount_idr), code: r.discount_code });

/** What pay/callback does on a PAID callback: the invoice `dibayar`, the store's first_invoice_paid. */
async function pay(storeId: string, number: string) {
  await client`update invoices set status = 'dibayar', paid_at = now() where number = ${number}`;
  await client`update stores set first_invoice_paid = true, current_period_end = now() + interval '1 month' where id = ${storeId}`;
}

beforeAll(async () => {
  if (!URL_) return;
  process.env.DATABASE_URL = URL_;
  client = postgres(URL_, { max: 3, onnotice: () => {} });
  si = await import("./subscription-invoice");
  finance = await holdPlatformFinance(client);
  await finance.setPpn(false);
  const [acc] = await client<{ id: string }[]>`insert into accounts (name) values (${`Harga ${run}`}) returning id`;
  accountId = acc.id;
});

afterAll(async () => {
  if (!client) return;
  try {
    await finance?.release();
    for (const id of stores) {
      await client`delete from invoices where store_id = ${id}`;
      await client`delete from stores where id = ${id}`;
    }
    for (const c of codes) await client`delete from signup_codes where code = ${c}`;
    if (accountId) await client`delete from accounts where id = ${accountId}`;
  } finally {
    await client.end();
  }
});

suite("ADR 0020 — the subscription price the ONE creator writes (real Postgres)", { timeout: 60_000 }, () => {
  it("no code → monthly Rp178.500, no discount, no promo", async () => {
    const id = await store();
    const r = await bill(id);
    expect(r.ok).toBe(true);
    const [row] = await rows(id);
    expect(money(row)).toEqual({ amount: 178_500, tax: 0, discount: 0, code: null });
    expect(row).toMatchObject({ cycle: "monthly", period_months: 1, status: "menunggu" });
    expect(provider.mock.calls.at(-1)?.[0].amount).toBe(178_500);
  });

  it("no code → annual Rp1.713.600, 13 months straight from the trial (bonus kept)", async () => {
    const id = await store();
    await bill(id, "annual");
    const [row] = await rows(id);
    expect(money(row)).toEqual({ amount: 1_713_600, tax: 0, discount: 0, code: null });
    expect(row.period_months).toBe(13);
  });

  it("discount code → FIRST monthly Rp78.500 (code printed on the row), the SECOND normal", async () => {
    const c = await code(100_000);
    const id = await store({ code: c });
    expect(await si.owedCodeDiscount(id)).toEqual({ code: c, discountIdr: 100_000 }); // the preview = the bill
    const first = await bill(id);
    expect(first.ok && first.detail).toMatchObject({ amountIdr: 78_500, codeDiscountIdr: 100_000, discountCode: c });
    const [r1] = await rows(id);
    expect(money(r1)).toEqual({ amount: 78_500, tax: 0, discount: 100_000, code: c });
    await pay(id, r1.number);
    expect(await si.owedCodeDiscount(id)).toEqual({ code: null, discountIdr: 0 });
    await bill(id);
    const all = await rows(id);
    expect(all).toHaveLength(2);
    expect(money(all[1])).toEqual({ amount: 178_500, tax: 0, discount: 0, code: null });
  });

  it("discount code → FIRST annual Rp1.613.600 (13 months), the next annual Rp1.713.600 (12)", async () => {
    const c = await code(100_000);
    const id = await store({ code: c });
    await bill(id, "annual");
    const [r1] = await rows(id);
    expect(money(r1)).toEqual({ amount: 1_613_600, tax: 0, discount: 100_000, code: c });
    expect(r1.period_months).toBe(13);
    await pay(id, r1.number);
    await bill(id, "annual");
    const all = await rows(id);
    expect(money(all[1])).toEqual({ amount: 1_713_600, tax: 0, discount: 0, code: null });
    expect(all[1].period_months).toBe(12);
  });

  it("never twice — a live discounted invoice is REUSED, not minted again", async () => {
    const id = await store({ code: await code(100_000) });
    const a = await bill(id);
    const b = await bill(id, "annual");
    expect(b.ok && b.reused).toBe(true);
    expect(a.ok && b.ok && b.detail.number).toBe(a.ok ? a.detail.number : "");
    expect(await rows(id)).toHaveLength(1);
  });

  it("never twice — an operator's manual 'Lunas' (no first_invoice_paid) still consumes it", async () => {
    const id = await store({ code: await code(100_000) });
    await bill(id);
    const [r1] = await rows(id);
    await client`update invoices set status = 'dibayar', paid_at = now() where number = ${r1.number}`; // bookkeeping only (ruling 2026-08-20)
    await bill(id);
    const all = await rows(id);
    expect(money(all[1])).toMatchObject({ amount: 178_500, discount: 0 });
  });

  it("a cancelled / expired UNPAID discounted invoice gives the discount back — switching monthly → annual keeps it", async () => {
    const c = await code(100_000);
    const id = await store({ code: c });
    await bill(id);
    const [r1] = await rows(id);
    await client`update invoices set status = 'gagal' where number = ${r1.number}`; // cancelSubscriptionInvoice / EXPIRED
    await bill(id, "annual");
    const all = await rows(id);
    expect(money(all[1])).toEqual({ amount: 1_613_600, tax: 0, discount: 100_000, code: c });
    // …and it is still only ONE payable discounted bill.
    expect(all.filter((r) => Number(r.code_discount_idr) > 0 && r.status === "menunggu")).toHaveLength(1);
  });

  it("0119 — two LIVE discounted invoices for one store are a DB impossibility", async () => {
    const id = await store({ code: await code(100_000) });
    await bill(id);
    const [r1] = await rows(id);
    const err = await client`insert into invoices (number, account_id, store_id, kind, amount_idr, code_discount_idr, discount_code, status)
                            values (${`X-${run}-${Date.now()}`}, ${accountId}, ${id}, 'subscription', 78500, 100000, ${r1.discount_code}, 'menunggu')`.catch((e) => e);
    expect(String(err?.constraint_name ?? err)).toContain("invoices_one_live_code_discount");
    // …while the pay callback's `gagal → dibayar` (a PAID after its EXPIRED) is NOT blocked by it.
    await client`update invoices set status = 'gagal' where number = ${r1.number}`;
    await bill(id);
    await client`update invoices set status = 'dibayar' where number = ${r1.number}`;
  });

  it("a RACE (two creators past the pending read at once) leaves exactly ONE live discounted invoice", async () => {
    const id = await store({ code: await code(100_000) });
    providerDelayMs = 150;
    try {
      const [a, b] = await Promise.all([bill(id), bill(id)]);
      expect(a.ok && b.ok).toBe(true);
      expect(a.ok && b.ok && a.detail.number === b.detail.number).toBe(true);
    } finally {
      providerDelayMs = 0;
    }
    const live = (await rows(id)).filter((r) => r.status === "menunggu");
    expect(live).toHaveLength(1);
    expect(money(live[0]).discount).toBe(100_000);
  });

  it("existing store: an invoice ISSUED before the change keeps its amount; the next one is the new price", async () => {
    const id = await store();
    // As issued pre-ADR-0020: the Rp50.000 first-month promo, still pending.
    await client`insert into invoices (number, account_id, store_id, kind, amount_idr, tax_idr, cycle, period_months, status)
                 values (${`OLD-${run}-1`}, ${accountId}, ${id}, 'subscription', 50000, 0, 'monthly', 1, 'menunggu')`;
    const reused = await bill(id);
    expect(reused.ok && reused.reused).toBe(true);
    expect(reused.ok && reused.detail.amountIdr).toBe(50_000); // never re-priced
    await pay(id, `OLD-${run}-1`);
    await bill(id);
    const all = await rows(id);
    expect(all.map((r) => Number(r.amount_idr))).toEqual([50_000, 178_500]);
  });

  it("existing PAID store at Rp275.000: history untouched, next invoice Rp178.500", async () => {
    const id = await store({ firstPaid: true });
    await client`insert into invoices (number, account_id, store_id, kind, amount_idr, tax_idr, cycle, period_months, status, paid_at)
                 values (${`OLD-${run}-2`}, ${accountId}, ${id}, 'subscription', 275000, 0, 'monthly', 1, 'dibayar', now())`;
    await bill(id);
    const all = await rows(id);
    expect(all.map((r) => Number(r.amount_idr))).toEqual([275_000, 178_500]);
  });

  it("provider-only code (discount 0) → normal price, no code on the row", async () => {
    const id = await store({ code: await code(0, "mengantar") });
    await bill(id);
    const [row] = await rows(id);
    expect(money(row)).toEqual({ amount: 178_500, tax: 0, discount: 0, code: null });
  });

  it("a code DEACTIVATED after signup is still honoured (granted at signup)", async () => {
    const c = await code(100_000);
    const id = await store({ code: c });
    await client`update signup_codes set active = false where code = ${c}`;
    await bill(id);
    const [row] = await rows(id);
    expect(money(row)).toMatchObject({ amount: 78_500, discount: 100_000 });
  });

  it("a VIP (comped) store owes no discount", async () => {
    const id = await store({ code: await code(100_000), comped: true });
    expect(await si.owedCodeDiscount(id)).toEqual({ code: null, discountIdr: 0 });
  });

  it("PPN ON: PPN is computed on the DISCOUNTED DPP and both numbers are stored", async () => {
    await finance.setPpn(true);
    try {
      const c = await code(100_000);
      const withCode = await store({ code: c });
      const plain = await store();
      const annual = await store({ code: c });
      await bill(withCode);
      await bill(plain);
      await bill(annual, "annual");
      expect(money((await rows(withCode))[0])).toEqual({ amount: 87_135, tax: 8_635, discount: 100_000, code: c });
      expect(money((await rows(plain))[0])).toEqual({ amount: 198_135, tax: 19_635, discount: 0, code: null });
      expect(money((await rows(annual))[0])).toEqual({ amount: 1_791_096, tax: 177_496, discount: 100_000, code: c });
    } finally {
      await finance.setPpn(false);
    }
  });
});
