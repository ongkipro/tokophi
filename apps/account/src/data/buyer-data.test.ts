import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Sql } from "postgres";
import { issueClaimToken } from "@tokophi/lib/claim-token";
import type { Db } from "./account";
import * as acct from "./account";
import * as ord from "./orders";
import * as addr from "./addresses";

// TokoΦ Account buyer half (Tasks 10.5–10.9) — real Postgres, every case rolled back. Isolation here is
// held by the buyer_id predicates and the claim + active-link join, not by RLS (spec §17.8 D-4).
const URL = process.env.TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;
const SECRET = "test-claim-secret-0123456789abcdef-0123456789";

let client: Sql;
let db: Db;
beforeAll(() => {
  if (!URL) return;
  client = postgres(URL, { max: 1, onnotice: () => {} });
  db = drizzle(client, { casing: "snake_case" }) as unknown as Db;
});
afterAll(async () => {
  await client?.end();
});
beforeEach(() => {
  process.env.ACCOUNT_CLAIM_SECRET = SECRET;
});

const ROLLBACK = Symbol("rollback");
async function inTxn(fn: (tx: Db) => Promise<void>) {
  try {
    await db.transaction(async (tx) => {
      await fn(tx as unknown as Db);
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
}
const rows = async (tx: Db, q: SQL) => (await tx.execute(q)) as unknown as Record<string, unknown>[];
const count = async (tx: Db, q: SQL) => Number((await rows(tx, q))[0].n);

let seq = 0;
async function store(tx: Db) {
  const n = `${Date.now()}-${++seq}`;
  const [acc] = await rows(tx, sql`insert into accounts (name) values ('Buyer Test') returning id`);
  const [s] = await rows(tx, sql`insert into stores (account_id, name, slug) values (${acc.id}, ${"Toko " + n}, ${"buyer-test-" + n}) returning id, slug`);
  return { id: s.id as string, slug: s.slug as string };
}
async function order(tx: Db, storeId: string, phone = "6281211110000") {
  const [c] = await rows(tx, sql`insert into customers (store_id, name, phone) values (${storeId}, 'Sari', ${phone}) returning id`);
  const number = `BUY-${Date.now()}-${++seq}`;
  const [o] = await rows(
    tx,
    sql`insert into orders (store_id, number, customer_id, status, subtotal_idr, total_idr, ship_recipient, ship_address)
        values (${storeId}, ${number}, ${c.id}, 'dikirim', 100000, 112000, 'Sari', 'Jl. Melati 12') returning id`,
  );
  await tx.execute(sql`insert into order_line_items (order_id, title, qty, price_idr, total_idr) values (${o.id}, 'Kemeja Batik', 2, 50000, 100000)`);
  return { id: o.id as string, number, customerId: c.id as string };
}
const account = async (tx: Db, email: string) => (await acct.upsertAccountBySub(tx, { sub: `dev:${email}`, email, name: email }))!;
const token = (orderId: string, nowMs = Date.now()) => issueClaimToken(orderId, SECRET, nowMs);

suite("claim an order (Task 10.5, ACC-11)", () => {
  it("valid token + consent ⇒ one claim + one active link; again ⇒ no-op success", async () => {
    await inTxn(async (tx) => {
      const me = await account(tx, "claim@demo.local");
      const s = await store(tx);
      const o = await order(tx, s.id);
      expect(await ord.previewClaim(tx, me, token(o.id))).toMatchObject({ state: "ready", orderNumber: o.number });
      expect(await ord.claimOrder(tx, me, token(o.id), "yes")).toEqual({ ok: true, orderNumber: o.number });
      expect(await ord.claimOrder(tx, me, token(o.id), "yes")).toEqual({ ok: true, orderNumber: o.number });
      expect(await count(tx, sql`select count(*) as n from buyer_order_claims where buyer_id = ${me}`)).toBe(1);
      const [link] = await rows(tx, sql`select status, customer_id, claim_method from buyer_store_links where buyer_id = ${me}`);
      expect(link).toEqual({ status: "active", customer_id: o.customerId, claim_method: "token" });
      expect((await ord.previewClaim(tx, me, token(o.id))).state).toBe("mine");
    });
  });

  it("tampered, expired, other order, declined, claimed by another ⇒ no row and the identical refusal", async () => {
    await inTxn(async (tx) => {
      const me = await account(tx, "me2@demo.local");
      const other = await account(tx, "other2@demo.local");
      const s = await store(tx);
      const o = await order(tx, s.id);
      const taken = await order(tx, s.id);
      expect((await ord.claimOrder(tx, other, token(taken.id), "yes")).ok).toBe(true);

      const good = token(o.id);
      const tampered = good.slice(0, -2) + (good.endsWith("AA") ? "BB" : "AA");
      const expired = token(o.id, Date.now() - 31 * 24 * 3600 * 1000);
      const unknownOrder = token("00000000-0000-4000-8000-000000000000");
      const cases: [unknown, unknown][] = [
        [tampered, "yes"],
        [expired, "yes"],
        [unknownOrder, "yes"],
        [good, "no"],
        [good, undefined],
        [token(taken.id), "yes"],
        [12345, "yes"],
      ];
      for (const [t, consent] of cases) expect(await ord.claimOrder(tx, me, t, consent)).toEqual({ ok: false });
      for (const t of [tampered, expired, unknownOrder, token(taken.id)]) expect(await ord.previewClaim(tx, me, t)).toEqual({ state: "invalid" });
      expect(await count(tx, sql`select count(*) as n from buyer_order_claims where buyer_id = ${me}`)).toBe(0);
      expect(await count(tx, sql`select count(*) as n from buyer_store_links where buyer_id = ${me}`)).toBe(0);
    });
  });

  it("no ACCOUNT_CLAIM_SECRET ⇒ nothing verifies (the feature is off)", async () => {
    await inTxn(async (tx) => {
      const me = await account(tx, "nosecret@demo.local");
      const s = await store(tx);
      const o = await order(tx, s.id);
      const t = token(o.id);
      delete process.env.ACCOUNT_CLAIM_SECRET;
      expect(await ord.claimOrder(tx, me, t, "yes")).toEqual({ ok: false });
    });
  });
});

suite("store return window on the order detail (Task 10.22)", () => {
  it("null until the store declares one; each store's own value; never another store's", async () => {
    await inTxn(async (tx) => {
      const me = await account(tx, "retur@demo.local");
      const A = await store(tx);
      const B = await store(tx);
      const a1 = await order(tx, A.id);
      const b1 = await order(tx, B.id);
      await ord.claimOrder(tx, me, token(a1.id), "yes");
      await ord.claimOrder(tx, me, token(b1.id), "yes");
      expect((await ord.myOrder(tx, me, a1.number))?.returnWindowDays).toBeNull(); // no settings row at all
      await tx.execute(sql`insert into store_settings (store_id, return_window_days) values (${A.id}, 7)`);
      await tx.execute(sql`insert into store_settings (store_id) values (${B.id})`);
      expect((await ord.myOrder(tx, me, a1.number))?.returnWindowDays).toBe(7);
      expect((await ord.myOrder(tx, me, b1.number))?.returnWindowDays).toBeNull(); // A's 7 does not leak to B
    });
  });
  it("the database refuses a window outside 1-90", async () => {
    await inTxn(async (tx) => {
      const A = await store(tx);
      for (const bad of [0, -1, 91]) {
        await expect(tx.transaction(async (t) => { await t.execute(sql`insert into store_settings (store_id, return_window_days) values (${A.id}, ${bad})`); })).rejects.toThrow();
      }
    });
  });
});

suite("order hub, stores, unlink (Tasks 10.6 / 10.7 / 10.9)", () => {
  it("exactly my claimed orders with an active link; foreign/unclaimed by number ⇒ not found; unlink drops the store and writes nothing store-owned", async () => {
    await inTxn(async (tx) => {
      const me = await account(tx, "hub@demo.local");
      const A = await store(tx);
      const B = await store(tx);
      const C = await store(tx);
      const a1 = await order(tx, A.id);
      const aUnclaimed = await order(tx, A.id); // same customer phone, never claimed
      const b1 = await order(tx, B.id);
      const c1 = await order(tx, C.id); // store C shares the phone, no link
      await ord.claimOrder(tx, me, token(a1.id), "yes");
      await ord.claimOrder(tx, me, token(b1.id), "yes");

      expect((await ord.myOrders(tx, me)).map((x) => x.number).sort()).toEqual([a1.number, b1.number].sort());
      expect(await ord.myOrder(tx, me, aUnclaimed.number)).toBeNull();
      expect(await ord.myOrder(tx, me, c1.number)).toBeNull();
      const d = await ord.myOrder(tx, me, a1.number);
      expect(d?.lines).toEqual([{ title: "Kemeja Batik", qty: 2, priceIdr: 50000, totalIdr: 100000, thumb: null }]);
      // The allowlist: nothing outside the projection leaves the data layer.
      expect(Object.keys(d!).sort()).toEqual(
        ["number", "placedAt", "status", "totalIdr", "storeName", "storeSlug", "items", "storeOrigin", "storeWhatsapp", "returnWindowDays", "subtotalIdr", "discountIdr", "shippingIdr", "taxIdr", "courier", "serviceType", "awb", "payment", "ship", "lines"].sort(),
      );

      // Another account sees none of it, by list or by number.
      const other = await account(tx, "hub-other@demo.local");
      expect(await ord.myOrders(tx, other)).toEqual([]);
      expect(await ord.myOrder(tx, other, a1.number)).toBeNull();
      expect(await ord.myStores(tx, other)).toEqual([]);
      expect(await ord.unlinkStore(tx, other, B.id)).toBe(false);

      // Stores: exactly the linked ones, each with its storefront origin (active primary domain wins).
      await tx.execute(sql`insert into store_domains (store_id, host, status, is_primary, verification_token) values (${A.id}, ${"shop-" + A.slug + ".example"}, 'active', true, 'x')`);
      const stores = await ord.myStores(tx, me);
      expect(stores.map((s) => s.storeId).sort()).toEqual([A.id, B.id].sort());
      expect(stores.find((s) => s.storeId === A.id)!.origin).toBe(`https://shop-${A.slug}.example`);
      expect(stores.find((s) => s.storeId === B.id)!.origin).toMatch(new RegExp(`^https://${B.slug}\\.`));

      // Unlink B: B leaves the hub, its store-owned rows are byte-for-byte untouched.
      const snap = sql`select (select count(*) from orders where store_id = ${B.id}) + (select count(*) from customers where store_id = ${B.id}) + (select count(*) from payments where store_id = ${B.id}) as n`;
      const before = await count(tx, snap);
      const orderRow = sql`select row_to_json(o)::text as n from orders o where id = ${b1.id}`;
      const [bBefore] = await rows(tx, orderRow);
      expect(await ord.unlinkStore(tx, me, B.id)).toBe(true);
      expect(await ord.unlinkStore(tx, me, B.id)).toBe(false);
      expect((await ord.myOrders(tx, me)).map((x) => x.number)).toEqual([a1.number]);
      expect(await ord.myOrder(tx, me, b1.number)).toBeNull();
      expect((await ord.myStores(tx, me)).map((s) => s.storeId)).toEqual([A.id]);
      expect(await count(tx, snap)).toBe(before);
      expect(await rows(tx, orderRow)).toEqual([bBefore]);
      expect(await count(tx, sql`select count(*) as n from buyer_order_claims where store_id = ${B.id}`)).toBe(1);

      // Re-claiming an order of B is fresh consent: the link comes back, and so does B's order.
      await ord.claimOrder(tx, me, token(b1.id), "yes");
      expect((await ord.myOrders(tx, me)).length).toBe(2);
    });
  });
});

// ── §18.4 hub filters, detail projection, buy again, store profile ──────────────────────────────────
async function product(tx: Db, storeId: string, title: string, opts: { status?: string; media?: string } = {}) {
  const n = ++seq;
  const [p] = await rows(
    tx,
    sql`insert into products (store_id, title, handle, status, number) values (${storeId}, ${title}, ${"p-" + Date.now() + "-" + n}, ${opts.status ?? "active"}, ${100000 + n}) returning id, handle`,
  );
  const [v] = await rows(tx, sql`insert into product_variants (product_id, store_id, title, price_idr, seq) values (${p.id}, ${storeId}, 'Default', 50000, 1) returning id`);
  if (opts.media) await tx.execute(sql`insert into product_media (product_id, url, position) values (${p.id}, ${opts.media}, 0)`);
  return { id: p.id as string, handle: p.handle as string, variantId: v.id as string };
}
async function line(tx: Db, orderId: string, title: string, variantId: string | null) {
  await tx.execute(sql`insert into order_line_items (order_id, variant_id, title, qty, price_idr, total_idr) values (${orderId}, ${variantId}, ${title}, 1, 50000, 50000)`);
}
const setStatus = (tx: Db, id: string, status: string) => tx.execute(sql`update orders set status = ${status} where id = ${id}`);
const pay = (tx: Db, o: { id: string }, storeId: string, method: string, status: string, extra: { va?: string; url?: string; qr?: string } = {}) =>
  tx.execute(sql`insert into payments (order_id, store_id, method, status, amount_idr, admin_fee, total, virtual_account, url, qr, reff_id, trx_id)
                 values (${o.id}, ${storeId}, ${method}, ${status}, 112000, 3000, 115000, ${extra.va ?? null}, ${extra.url ?? null}, ${extra.qr ?? null}, 'REFF-SECRET', 'TRX-SECRET')`);

suite("hub filters, detail, buy again, store profile (spec §18.4)", () => {
  it("q / toko / status only ever narrow MY orders; wildcards are literal", async () => {
    await inTxn(async (tx) => {
      const me = await account(tx, "flt@demo.local");
      const other = await account(tx, "flt-other@demo.local");
      const A = await store(tx);
      const B = await store(tx);
      const a1 = await order(tx, A.id); // dikirim, "Kemeja Batik"
      const a2 = await order(tx, A.id);
      const b1 = await order(tx, B.id);
      const foreign = await order(tx, A.id); // same store, claimed by another account
      const unclaimed = await order(tx, A.id);
      await line(tx, a2.id, "Gamis 100% Katun", null);
      await setStatus(tx, a2.id, "selesai");
      await setStatus(tx, b1.id, "baru");
      await pay(tx, b1, B.id, "va", "menunggu", { va: "8808123" });
      await line(tx, foreign.id, "Gamis 100% Katun", null);
      await setStatus(tx, foreign.id, "selesai");
      for (const x of [a1, a2, b1]) await ord.claimOrder(tx, me, token(x.id), "yes");
      await ord.claimOrder(tx, other, token(foreign.id), "yes");
      const nums = async (f: ord.OrderFilter) => (await ord.myOrders(tx, me, f)).map((x) => x.number).sort();

      expect(await nums({})).toEqual([a1.number, a2.number, b1.number].sort());
      expect(await nums({ toko: A.slug })).toEqual([a1.number, a2.number].sort());
      expect(await nums({ q: "gamis" })).toEqual([a2.number]); // line title, case-insensitive; not `foreign`
      expect(await nums({ q: b1.number.slice(4) })).toEqual([b1.number]); // part of the order number
      expect(await nums({ q: "%" })).toEqual([a2.number]); // `%` is a literal: only "100%" matches
      expect(await nums({ q: "_" })).toEqual([]);
      expect(await nums({ status: "belum-bayar" })).toEqual([b1.number]);
      expect(await nums({ status: "aktif" })).toEqual([a1.number, b1.number].sort());
      expect(await nums({ status: "selesai" })).toEqual([a2.number]);
      expect(await nums({ status: "batal" })).toEqual([]);
      await setStatus(tx, a1.id, "retur");
      expect(await nums({ status: "batal" })).toEqual([a1.number]); // batal covers retur
      expect(await nums({ status: "selesai", toko: B.slug })).toEqual([]);
      // Another store's slug, an unclaimed order's number: nothing widens.
      expect(await nums({ q: unclaimed.number })).toEqual([]);
      expect(await nums({ q: foreign.number })).toEqual([]);
      expect(await ord.myOrders(tx, other, { toko: A.slug, status: "selesai" })).toHaveLength(1);
      expect(await ord.myOrders(tx, other, { toko: B.slug })).toEqual([]);
      // Unlinking B hides B's order from every filter combination.
      await ord.unlinkStore(tx, me, B.id);
      expect(await nums({ status: "belum-bayar" })).toEqual([]);
      expect(await nums({ toko: B.slug })).toEqual([]);
    });
  });

  it("detail: thumbnail via variant → media (store-bound), payment allowlist, VA only while waiting, another buyer ⇒ null", async () => {
    await inTxn(async (tx) => {
      const me = await account(tx, "det@demo.local");
      const other = await account(tx, "det-other@demo.local");
      const A = await store(tx);
      const X = await store(tx);
      const pA = await product(tx, A.id, "Kemeja", { media: "/products/kemeja.webp" });
      const pX = await product(tx, X.id, "Foreign", { media: "https://x.example/leak.webp" }); // another store's variant
      const o = await order(tx, A.id);
      await line(tx, o.id, "A Kemeja — Putih / M", pA.variantId);
      await line(tx, o.id, "B Foreign", pX.variantId);
      await setStatus(tx, o.id, "baru");
      await pay(tx, o, A.id, "va", "menunggu", { va: "8808123456", url: "https://pay.example/x", qr: "QRSTRING" });
      await ord.claimOrder(tx, me, token(o.id), "yes");

      const d = (await ord.myOrder(tx, me, o.number))!;
      const thumbs = Object.fromEntries(d.lines.map((l) => [l.title, l.thumb]));
      expect(thumbs["A Kemeja — Putih / M"]).toMatch(/^https:\/\/.+\/products\/kemeja\.webp$/);
      expect(thumbs["B Foreign"]).toBeNull();
      expect(thumbs["Kemeja Batik"]).toBeNull(); // no variant
      expect(d.payment).toEqual({ method: "va", status: "menunggu", amountIdr: 112000, adminFeeIdr: 3000, totalIdr: 115000, channel: null, virtualAccount: "8808123456", url: "https://pay.example/x" });
      expect(JSON.stringify(d)).not.toMatch(/SECRET|QRSTRING/);
      const hub = (await ord.myOrders(tx, me))[0];
      expect(hub.thumb).toBe(thumbs["A Kemeja — Putih / M"]); // first line by title
      expect(ord.isUnpaid(hub)).toBe(true);

      await tx.execute(sql`update payments set status = 'berhasil', paid_at = now() where order_id = ${o.id}`);
      const paid = (await ord.myOrder(tx, me, o.number))!;
      expect(paid.payment).toMatchObject({ status: "berhasil", virtualAccount: null, url: null });
      expect(await ord.myOrder(tx, other, o.number)).toBeNull();

      // A merchant upload is served by the Seller app, not the store origin: no admin origin ⇒ no URL.
      await tx.execute(sql`update product_media set url = '/api/uploads/k.webp' where product_id = ${pA.id}`);
      const saved = { a: process.env.ADMIN_URL, p: process.env.PUBLIC_ONGKIR_API };
      try {
        delete process.env.ADMIN_URL;
        delete process.env.PUBLIC_ONGKIR_API;
        expect((await ord.myOrder(tx, me, o.number))!.lines[0].thumb).toBeNull();
        process.env.ADMIN_URL = "https://app.example.test/x";
        expect((await ord.myOrder(tx, me, o.number))!.lines[0].thumb).toBe("https://app.example.test/api/uploads/k.webp?w=200");
        process.env.ADMIN_URL = "http://app.example.test"; // plain http is not an honest origin for a personal page
        expect((await ord.myOrder(tx, me, o.number))!.lines[0].thumb).toBeNull();
      } finally {
        for (const [k, v] of [["ADMIN_URL", saved.a], ["PUBLIC_ONGKIR_API", saved.p]] as const) if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
    });
  });

  it("media URLs: only https on the store's own host (or the admin upload origin); foreign host / http ⇒ icon", async () => {
    await inTxn(async (tx) => {
      const me = await account(tx, "media@demo.local");
      const A = await store(tx);
      const pA = await product(tx, A.id, "Kemeja", { media: "/products/k.webp" });
      const o = await order(tx, A.id);
      await tx.execute(sql`delete from order_line_items where order_id = ${o.id}`);
      await line(tx, o.id, "Kemeja", pA.variantId);
      await ord.claimOrder(tx, me, token(o.id), "yes");
      const host = new globalThis.URL((await ord.myOrder(tx, me, o.number))!.storeOrigin).host;
      const thumbFor = async (url: string) => {
        await tx.execute(sql`update product_media set url = ${url} where product_id = ${pA.id}`);
        return (await ord.myOrder(tx, me, o.number))!.lines[0].thumb;
      };
      expect(await thumbFor("/products/k.webp")).toBe(`https://${host}/products/k.webp`);
      expect(await thumbFor(`https://${host}/products/k.webp`)).toBe(`https://${host}/products/k.webp`);
      expect(await thumbFor(`http://${host}/products/k.webp`)).toBeNull();
      expect(await thumbFor("https://tracker.example/pixel.gif")).toBeNull();
      expect(await thumbFor("//tracker.example/pixel.gif")).toBeNull();
      expect(await thumbFor("javascript:alert(1)")).toBeNull();
    });
  });

  it("a second claim from an already-active link keeps the original consent time; re-linking after unlink renews it", async () => {
    await inTxn(async (tx) => {
      const me = await account(tx, "consent@demo.local");
      const A = await store(tx);
      const o1 = await order(tx, A.id);
      const o2 = await order(tx, A.id);
      const o3 = await order(tx, A.id);
      await ord.claimOrder(tx, me, token(o1.id), "yes");
      const past = sql`update buyer_store_links set consented_at = '2026-01-02T03:04:05Z', created_at = '2026-01-02T03:04:05Z' where buyer_id = ${me}`;
      await tx.execute(past);
      const consentedAt = async () => new Date(String((await rows(tx, sql`select consented_at::text as t from buyer_store_links where buyer_id = ${me}`))[0].t)).toISOString();
      await ord.claimOrder(tx, me, token(o2.id), "yes");
      expect(await consentedAt()).toBe("2026-01-02T03:04:05.000Z");
      expect((await ord.myStore(tx, me, A.slug))!.linkedAt.toISOString()).toBe("2026-01-02T03:04:05.000Z");

      await ord.unlinkStore(tx, me, A.id);
      await ord.claimOrder(tx, me, token(o3.id), "yes");
      expect(await consentedAt()).not.toBe("2026-01-02T03:04:05.000Z"); // fresh consent after a revoke
      // The profile still shows the FIRST connection, and every order saved earlier is back.
      expect((await ord.myStore(tx, me, A.slug))!.linkedAt.toISOString()).toBe("2026-01-02T03:04:05.000Z");
      expect((await ord.myOrders(tx, me)).length).toBe(3);

      // New consent wording also counts as new consent.
      await tx.execute(sql`update buyer_store_links set consent_version = 'old', consented_at = '2026-01-02T03:04:05Z' where buyer_id = ${me}`);
      await ord.claimOrder(tx, me, token(o1.id), "yes");
      expect(await consentedAt()).not.toBe("2026-01-02T03:04:05.000Z");
    });
  });

  it("buy again: only active products from MY `selesai` orders, distinct, newest first", async () => {
    await inTxn(async (tx) => {
      const me = await account(tx, "again@demo.local");
      const other = await account(tx, "again-other@demo.local");
      const A = await store(tx);
      const p1 = await product(tx, A.id, "Kemeja Satu", { media: "/products/a.webp" });
      const p2 = await product(tx, A.id, "Rok Dua");
      const pDraft = await product(tx, A.id, "Draft", { status: "draft" });
      const pShipping = await product(tx, A.id, "Masih Dikirim");
      const pTheirs = await product(tx, A.id, "Punya Orang");
      const done1 = await order(tx, A.id);
      const done2 = await order(tx, A.id);
      const shipping = await order(tx, A.id);
      const theirs = await order(tx, A.id);
      await line(tx, done1.id, "x", p1.variantId);
      await line(tx, done1.id, "y", pDraft.variantId);
      await line(tx, done2.id, "z", p1.variantId);
      await line(tx, done2.id, "w", p2.variantId);
      await line(tx, shipping.id, "s", pShipping.variantId);
      await line(tx, theirs.id, "t", pTheirs.variantId);
      for (const x of [done1, done2, theirs]) await setStatus(tx, x.id, "selesai");
      for (const x of [done1, done2, shipping]) await ord.claimOrder(tx, me, token(x.id), "yes");
      await ord.claimOrder(tx, other, token(theirs.id), "yes");

      const got = await ord.buyAgain(tx, me);
      expect(got.map((g) => g.title).sort()).toEqual(["Kemeja Satu", "Rok Dua"]);
      expect(got.find((g) => g.title === "Kemeja Satu")!.url).toMatch(new RegExp(`/produk/${p1.handle}$`));
      expect(got.find((g) => g.title === "Rok Dua")!.thumb).toBeNull();
      expect((await ord.buyAgain(tx, other)).map((g) => g.title)).toEqual(["Punya Orang"]);
      await ord.unlinkStore(tx, me, A.id);
      expect(await ord.buyAgain(tx, me)).toEqual([]);
    });
  });

  it("store profile: only an ACTIVE link of mine, by slug; unlinked / foreign / unknown ⇒ null", async () => {
    await inTxn(async (tx) => {
      const me = await account(tx, "prof@demo.local");
      const other = await account(tx, "prof-other@demo.local");
      const A = await store(tx);
      const B = await store(tx);
      const a1 = await order(tx, A.id);
      const a2 = await order(tx, A.id);
      const b1 = await order(tx, B.id);
      await ord.claimOrder(tx, me, token(a1.id), "yes");
      await ord.claimOrder(tx, me, token(a2.id), "yes");
      await ord.claimOrder(tx, other, token(b1.id), "yes");

      expect(await ord.myStore(tx, me, A.slug)).toMatchObject({ storeId: A.id, slug: A.slug, orders: 2 });
      expect(await ord.myStore(tx, me, B.slug)).toBeNull(); // another buyer's store
      expect(await ord.myStore(tx, me, "no-such-store")).toBeNull();
      expect(await ord.myStore(tx, me, 42)).toBeNull();
      expect(await ord.myStore(tx, other, A.slug)).toBeNull();
      expect((await ord.myStores(tx, me)).map((s) => s.slug)).toEqual([A.slug]);
      expect(await ord.countMyAddresses(tx, me)).toBe(0);
      await ord.unlinkStore(tx, me, A.id);
      expect(await ord.myStore(tx, me, A.slug)).toBeNull();
    });
  });
});

suite("saved addresses (Task 10.8, ACC-7)", () => {
  async function district(tx: Db) {
    const id = 990000 + (++seq % 9000);
    await tx.execute(sql`insert into kiriminaja_areas (id, district_name, city_type, city_name, province_name)
                         values (${id}, 'Sewon', 'Kabupaten', 'Bantul', 'DI Yogyakarta') on conflict (id) do nothing`);
    return id;
  }
  const input = (districtId: number, extra: Partial<addr.AddressInput> = {}) => ({
    label: "Rumah",
    recipient: "Sari Dewi",
    phone: "0812-3456-7890",
    address: "Jl. Melati No. 12, RT 03/RW 05",
    districtId,
    postalCode: "55185",
    ...extra,
  });

  it("first is primary; 11th refused; one primary after flips and deletes; foreign ids refused", async () => {
    await inTxn(async (tx) => {
      const me = await account(tx, "addr@demo.local");
      const other = await account(tx, "addr-other@demo.local");
      const dist = await district(tx);
      const ids: string[] = [];
      for (let i = 0; i < addr.MAX_ADDRESSES; i++) {
        const r = await addr.saveAddress(tx, me, input(dist, { label: `A${i}` }));
        expect(r.ok).toBe(true);
        if (r.ok) ids.push(r.id);
      }
      const eleventh = await addr.saveAddress(tx, me, input(dist));
      expect(eleventh.ok).toBe(false);
      const primaries = sql`select count(*) as n from buyer_addresses where buyer_id = ${me} and is_primary`;
      expect(await count(tx, primaries)).toBe(1);
      expect((await addr.myAddresses(tx, me))[0].id).toBe(ids[0]);
      const saved = await addr.myAddress(tx, me, ids[0]);
      expect(saved).toMatchObject({ phone: "6281234567890", postalCode: "55185", area: { id: dist } });

      expect(await addr.setPrimaryAddress(tx, me, ids[3])).toBe(true);
      expect(await count(tx, primaries)).toBe(1);
      expect((await addr.myAddresses(tx, me))[0].id).toBe(ids[3]);
      expect(await addr.deleteAddress(tx, me, ids[3])).toBe(true);
      expect(await count(tx, primaries)).toBe(1);

      // Another account can neither read, edit, flip nor delete my rows.
      expect(await addr.myAddress(tx, other, ids[0])).toBeNull();
      expect(await addr.saveAddress(tx, other, input(dist), ids[0])).toEqual({ ok: false, errors: { form: "Alamat tidak ditemukan." } });
      expect(await addr.setPrimaryAddress(tx, other, ids[0])).toBe(false);
      expect(await addr.deleteAddress(tx, other, ids[0])).toBe(false);
      expect(await addr.myAddresses(tx, other)).toEqual([]);
    });
  });

  it("validation: unknown district, bad phone/postcode/name refused with the checkout's own messages", async () => {
    await inTxn(async (tx) => {
      const me = await account(tx, "addr-v@demo.local");
      const r = await addr.saveAddress(tx, me, input(123456789, { phone: "12345", postalCode: "55", recipient: "R2D2" }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["districtId", "phone", "postalCode", "recipient"]);
    });
  });

  it("editing a saved address never touches an order's ship_* snapshot", async () => {
    await inTxn(async (tx) => {
      const me = await account(tx, "addr-o@demo.local");
      const dist = await district(tx);
      const s = await store(tx);
      const o = await order(tx, s.id);
      await ord.claimOrder(tx, me, token(o.id), "yes");
      const snap = sql`select row_to_json(o)::text as n from orders o where id = ${o.id}`;
      const [before] = await rows(tx, snap);
      const r = await addr.saveAddress(tx, me, input(dist));
      if (!r.ok) throw new Error("save failed");
      await addr.saveAddress(tx, me, input(dist, { address: "Jl. Kenanga No. 99, RT 01/RW 02" }), r.id);
      await addr.deleteAddress(tx, me, r.id);
      expect(await rows(tx, snap)).toEqual([before]);
    });
  });
});
