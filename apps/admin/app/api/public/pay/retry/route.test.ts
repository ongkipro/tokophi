import { createHash, randomBytes, randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// PAY-RETRY — "Bayar ulang" against REAL PostgreSQL, through the real route and the real AutoLaris
// client (`alCreateOrder` → `parseAlExpiry`), with `fetch` stubbed. The claims are about a row lock,
// a WHERE clause and what lands in `payments`: a mocked database could only agree with itself.
//
// 🔴 NO VENDOR IS EVER CALLED. `AUTOLARIS_BASE` is an `.invalid` host (RFC 2606) and the stub
// refuses every URL that does not start with it, so a mis-wired base fails the test instead of
// reaching AutoLaris.

const URL = process.env.TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;
const runId = randomUUID().slice(0, 8);
const FAKE_BASE = "https://autolaris.invalid";
const CHANNEL = `QRT${runId}`.toUpperCase();

type VendorAnswer = { kind: "ok"; expired: string } | { kind: "refuse" } | { kind: "throw" };
const vendor = {
  next: [] as VendorAnswer[],
  calls: [] as { url: string; body: Record<string, unknown> }[],
  gate: null as null | Promise<void>,
};
const fakeFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (!url.startsWith(FAKE_BASE)) throw new Error(`test fetch refused a non-stub URL: ${url}`);
  const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
  vendor.calls.push({ url, body });
  if (vendor.gate) await vendor.gate;
  const a = vendor.next.shift() ?? { kind: "ok", expired: "2099-01-01 00:00:00" };
  if (a.kind === "throw") throw new TypeError("fetch failed");
  if (a.kind === "refuse") return new Response(JSON.stringify({ rc: "07", ket: "Saldo merchant tidak cukup (vendor words)" }));
  return new Response(
    JSON.stringify({
      rc: "00",
      ket: "SUCCESS",
      data: {
        transaction_id: `TRX-${randomUUID().slice(0, 8)}`,
        total: Number(body.grand_total),
        biaya_admin: 700,
        payment_info: { expired: a.expired, va: "", qr: "00020101021226NEWQR6304ABCD", url: "" },
      },
    }),
  );
});

let client: Sql;
let POST: (r: Request) => Promise<Response>;
let accountId = "";
let storeId = "";
let slug = "";
let customerId = "";

const hash = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const token = () => randomBytes(32).toString("base64url");

const retry = (body: Record<string, unknown>, ip = "203.0.113.7") =>
  POST(
    new Request("http://admin.test/api/public/pay/retry", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }),
  );

/** An order the checkout created: one QRIS attempt (reff = order number), and its shopper token. */
async function makeOrder(opts: {
  status?: string;
  financial?: string;
  placedHoursAgo?: number;
  first?: { status?: string; expiresAt?: Date | null; method?: string } | null;
} = {}) {
  const number = `PHI-${randomUUID().slice(0, 12).toUpperCase()}`;
  const t = token();
  const [o] = await client<{ id: string }[]>`
    insert into orders (store_id, customer_id, number, status, financial_status, total_idr, placed_at, pay_token_hash)
    values (${storeId}, ${customerId}, ${number}, ${opts.status ?? "baru"}, ${opts.financial ?? "pending"}, 100000,
            ${new Date(Date.now() - (opts.placedHoursAgo ?? 3) * 3600_000)}, ${hash(t)})
    returning id`;
  if (opts.first !== null) {
    const f = opts.first ?? {};
    await client`
      insert into payments (order_id, store_id, method, amount_idr, admin_fee, total, status, provider, reff_id, channel_code, qr, expires_at)
      values (${o.id}, ${storeId}, ${f.method ?? "qris"}, 100000, 700, 100700, ${f.status ?? "menunggu"}, 'autolaris', ${number},
              ${CHANNEL}, '00020101021226OLDQR6304ABCD',
              ${f.expiresAt === undefined ? new Date(Date.now() - 3600_000) : f.expiresAt})`;
  }
  return { id: o.id, number, token: t };
}

const rowsOf = (orderId: string) =>
  client<{
    reff_id: string; status: string; request_state: string | null; request_error: string | null;
    amount_idr: string; admin_fee: string; total: string; channel_code: string; qr: string | null;
    expires_at: Date | null; trx_id: string | null;
  }[]>`
    select reff_id, status, request_state, request_error, amount_idr, admin_fee, total, channel_code, qr, expires_at, trx_id
      from payments where order_id = ${orderId} order by created_at, id`;

beforeAll(async () => {
  if (!URL) return;
  process.env.DATABASE_URL = URL;
  process.env.AUTOLARIS_BASE = FAKE_BASE;
  process.env.AUTOLARIS_API_KEY = "test-key-not-real";
  vi.stubGlobal("fetch", fakeFetch);
  client = postgres(URL, { max: 6 });
  ({ POST } = await import("./route"));
  const [acc] = await client<{ id: string }[]>`insert into accounts (name) values (${`Retry ${runId}`}) returning id`;
  accountId = acc.id;
  slug = `retry-${runId}`;
  const [s] = await client<{ id: string }[]>`
    insert into stores (account_id, name, slug, status) values (${accountId}, ${`Retry ${runId}`}, ${slug}, 'active') returning id`;
  storeId = s.id;
  const [c] = await client<{ id: string }[]>`
    insert into customers (store_id, name, email, phone) values (${storeId}, 'Siti Pembeli', 'siti@example.test', '6281234567890') returning id`;
  customerId = c.id;
  await client`insert into platform_payment_channels (channel, label, kind, enabled, active) values (${CHANNEL}, 'QRIS Uji', 'qris', true, true)`;
});

afterAll(async () => {
  if (!client) return;
  vi.unstubAllGlobals();
  await client`delete from payments where store_id = ${storeId}`;
  await client`delete from orders where store_id = ${storeId}`;
  await client`delete from customers where store_id = ${storeId}`;
  await client`delete from stores where id = ${storeId}`;
  await client`delete from accounts where id = ${accountId}`;
  await client`delete from platform_payment_channels where channel = ${CHANNEL}`;
  await client.end();
});

beforeEach(() => {
  vendor.next = [];
  vendor.calls = [];
  vendor.gate = null;
});

suite("POST /api/public/pay/retry (real PostgreSQL, stubbed vendor)", () => {
  it("expired QRIS → ONE new instruction for the same order, same money, fresh reference; the old row is closed", async () => {
    const o = await makeOrder();
    vendor.next.push({ kind: "ok", expired: "2099-11-13 16:45:00" });
    const res = await retry({ storeSlug: slug, orderNumber: o.number, token: o.token }, "203.0.113.10");
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.payment.qr).toBe("00020101021226NEWQR6304ABCD");
    expect(json.payment.total).toBe(100700);
    // The vendor's zoneless WIB wall clock, handed on as an instant.
    expect(json.payment.expiresAt).toBe("2099-11-13T09:45:00.000Z");

    expect(vendor.calls).toHaveLength(1);
    expect(vendor.calls[0].url).toBe(`${FAKE_BASE}/api/h2h/submit`);
    expect(vendor.calls[0].body.reff_id).toBe(`${o.number}-2`);
    expect(vendor.calls[0].body.grand_total).toBe("100700");
    expect(vendor.calls[0].body.channel_code).toBe(CHANNEL);
    expect(String(vendor.calls[0].body.callback_url)).toContain("/api/public/pay/callback");

    const rows = await rowsOf(o.id);
    expect(rows.map((r) => [r.reff_id, r.status])).toEqual([
      [o.number, "gagal"],
      [`${o.number}-2`, "menunggu"],
    ]);
    const n = rows[1];
    expect(n.request_state).toBe("accepted");
    expect([Number(n.amount_idr), Number(n.admin_fee), Number(n.total)]).toEqual([100000, 700, 100700]);
    expect(n.expires_at?.toISOString()).toBe("2099-11-13T09:45:00.000Z");
    expect(n.trx_id).toMatch(/^TRX-/);
  });

  it("a second press while the new bill is live re-shows THAT bill — no second vendor call, no second row", async () => {
    const o = await makeOrder();
    await retry({ storeSlug: slug, orderNumber: o.number, token: o.token }, "203.0.113.11");
    const again = await (await retry({ storeSlug: slug, orderNumber: o.number, token: o.token }, "203.0.113.11")).json();
    expect(again).toMatchObject({ ok: true, reused: true });
    expect(again.payment.qr).toBe("00020101021226NEWQR6304ABCD");
    expect(vendor.calls).toHaveLength(1);
    expect(await rowsOf(o.id)).toHaveLength(2);
  });

  it("two simultaneous presses → exactly one new bill (the order's row lock decides)", async () => {
    const o = await makeOrder();
    let open!: () => void;
    vendor.gate = new Promise<void>((r) => (open = r));
    const a = retry({ storeSlug: slug, orderNumber: o.number, token: o.token }, "203.0.113.12");
    const b = retry({ storeSlug: slug, orderNumber: o.number, token: o.token }, "203.0.113.13");
    // Let the loser reach its decision while the winner's vendor call is still in flight.
    await new Promise((r) => setTimeout(r, 300));
    open();
    const answers = await Promise.all([a, b].map(async (p) => (await p).json()));
    expect(vendor.calls).toHaveLength(1);
    expect(await rowsOf(o.id)).toHaveLength(2);
    const codes = answers.map((j) => (j.ok ? (j.reused ? "reused" : "new") : j.code)).sort();
    expect(codes).toContain("new");
    expect(["in_progress", "reused"]).toContain(codes.find((c) => c !== "new"));
  });

  it("a live first bill is handed back, not replaced", async () => {
    const o = await makeOrder({ first: { expiresAt: new Date(Date.now() + 3600_000) } });
    const j = await (await retry({ storeSlug: slug, orderNumber: o.number, token: o.token }, "203.0.113.14")).json();
    expect(j).toMatchObject({ ok: true, reused: true });
    expect(j.payment.qr).toBe("00020101021226OLDQR6304ABCD");
    expect(vendor.calls).toHaveLength(0);
  });

  it("the order number alone opens nothing: no token, a wrong token, another store → the same 404", async () => {
    const o = await makeOrder();
    for (const body of [
      { storeSlug: slug, orderNumber: o.number },
      { storeSlug: slug, orderNumber: o.number, token: token() },
      { storeSlug: "toko-lain", orderNumber: o.number, token: o.token },
    ]) {
      const res = await retry(body, "203.0.113.15");
      expect(res.status).toBe(404);
      expect((await res.json()).code).toBe("not_found");
    }
    expect(vendor.calls).toHaveLength(0);
    expect(await rowsOf(o.id)).toHaveLength(1);
  });

  it("refuses a paid, a cancelled, an already-processed and a too-old order — and writes nothing", async () => {
    const cases: [Parameters<typeof makeOrder>[0], string][] = [
      [{ first: { status: "berhasil" } }, "already_paid"],
      [{ status: "batal" }, "order_closed"],
      [{ status: "diproses" }, "order_closed"],
      [{ placedHoursAgo: 23.9 }, "order_expired"],
      [{ first: { expiresAt: null }, placedHoursAgo: 3 }, "unknown_outcome"],
    ];
    for (const [opts, code] of cases) {
      const o = await makeOrder(opts);
      const res = await retry({ storeSlug: slug, orderNumber: o.number, token: o.token }, "203.0.113.16");
      expect(res.status, code).toBe(409);
      expect((await res.json()).code).toBe(code);
      expect(await rowsOf(o.id), code).toHaveLength(1);
    }
    expect(vendor.calls).toHaveLength(0);
  });

  it("a vendor REFUSAL fails the attempt (retryable) and never shows the vendor's words", async () => {
    const o = await makeOrder();
    vendor.next.push({ kind: "refuse" });
    const res = await retry({ storeSlug: slug, orderNumber: o.number, token: o.token }, "203.0.113.17");
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain("vendor words");
    expect(JSON.parse(text).error).toBe("Pembayaran tidak dapat dimulai. Hubungi penjual dengan nomor pesanan ini.");
    const rows = await rowsOf(o.id);
    expect(rows[1]).toMatchObject({ status: "gagal", request_state: "failed" });
    expect(rows[1].request_error).toContain("vendor words"); // kept for the Seller
    // …and the shopper may try again: attempt 3.
    const ok = await (await retry({ storeSlug: slug, orderNumber: o.number, token: o.token }, "203.0.113.17")).json();
    expect(ok.ok).toBe(true);
    expect(vendor.calls.at(-1)?.body.reff_id).toBe(`${o.number}-3`);
  });

  it("a THROWN call is an unknown outcome: no further bill until it is bounded", async () => {
    const o = await makeOrder();
    vendor.next.push({ kind: "throw" });
    expect((await retry({ storeSlug: slug, orderNumber: o.number, token: o.token }, "203.0.113.18")).status).toBe(502);
    const rows = await rowsOf(o.id);
    expect(rows[1]).toMatchObject({ status: "menunggu", request_state: "failed", expires_at: null });
    const next = await retry({ storeSlug: slug, orderNumber: o.number, token: o.token }, "203.0.113.18");
    expect(next.status).toBe(409);
    expect((await next.json()).code).toBe("unknown_outcome");
    expect(vendor.calls).toHaveLength(1);
  });

  it("stops at MAX_PAY_ATTEMPTS", async () => {
    const o = await makeOrder();
    for (let i = 0; i < 4; i++) vendor.next.push({ kind: "refuse" });
    const codes: string[] = [];
    for (let i = 0; i < 5; i++) {
      const j = await (await retry({ storeSlug: slug, orderNumber: o.number, token: o.token }, `203.0.113.${40 + i}`)).json();
      codes.push(j.ok ? "ok" : j.code);
    }
    expect(codes).toEqual(["payment_start_failed", "payment_start_failed", "payment_start_failed", "payment_start_failed", "attempt_limit"]);
    expect(await rowsOf(o.id)).toHaveLength(5);
  });

  it("a channel the platform switched off since checkout is not re-billed", async () => {
    const o = await makeOrder();
    await client`update platform_payment_channels set enabled = false where channel = ${CHANNEL}`;
    try {
      const res = await retry({ storeSlug: slug, orderNumber: o.number, token: o.token }, "203.0.113.19");
      expect((await res.json()).code).toBe("channel_off");
      expect(await rowsOf(o.id)).toHaveLength(1);
    } finally {
      await client`update platform_payment_channels set enabled = true where channel = ${CHANNEL}`;
    }
  });
});
