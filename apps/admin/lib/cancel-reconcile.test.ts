import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { codeOnly, textWithoutComments } from "../../../test/source-code";
import { decideCancelReconcile, isNotFoundReply, NOT_FOUND_NOTE, type CancelVendorReply } from "./cancel-reconcile";
import type { KaOutcome } from "./ka-tracking";

// Task 5.1 / F-S12 — the cancellation reconciler.
//
// Three layers, because each catches a different class of regression:
//   ① the DECISION TABLE (pure, no DB) — every branch of `decideCancelReconcile`;
//   ② SOURCE claims (`codeOnly`) that the decision is actually consulted where it must be — inside
//      `syncOrderFromKa`, ABOVE the ordinary forward mapping, and that the poller feeds the one branch
//      a healthy pull can never produce (`not_found`);
//   ③ the real Postgres shape: seed a pending cancellation, feed the sync the vendor's answer, read
//      back what was written. This is the half that would have caught "300 → batal on a merchant's
//      own void", which no type-checker has an opinion on.

// ── ① The decision table ─────────────────────────────────────────────────────────────────────────
const tracked = (outcome: KaOutcome | null): CancelVendorReply => ({ kind: "tracked", outcome });

const TABLE: [label: string, reply: CancelVendorReply, action: string][] = [
  ["vendor down", { kind: "down" }, "wait"],
  ["vendor says not found", { kind: "not_found" }, "attention"],
  ["unmapped / 350 requested-not-granted", tracked(null), "wait"],
  ["still at origin (booked)", tracked("booked"), "wait"],
  ["courier confirms the void (300/302)", tracked("canceled"), "void"],
  ["picked up anyway (shipped)", tracked("shipped"), "revert"],
  ["delivered anyway", tracked("delivered"), "revert"],
  ["returned", tracked("returned"), "revert"],
  ["courier problem", tracked("problem"), "revert"],
];

describe("decideCancelReconcile — every vendor reply has exactly one answer", () => {
  it.each(TABLE)("%s → %s", (_label, reply, action) => {
    expect(decideCancelReconcile(reply).action).toBe(action);
  });

  it("every KaOutcome is covered by the table (a new outcome must be classified, not defaulted)", () => {
    const outcomes: KaOutcome[] = ["booked", "shipped", "delivered", "returned", "canceled", "problem"];
    const covered = new Set(TABLE.map(([, r]) => (r.kind === "tracked" ? r.outcome : null)));
    for (const o of outcomes) expect(covered.has(o), `outcome ${o} missing from TABLE`).toBe(true);
  });

  it("revert and attention carry a merchant-facing note; void and wait carry none", () => {
    const revert = decideCancelReconcile(tracked("shipped"));
    expect(revert.action === "revert" && revert.note.length > 20).toBe(true);
    const att = decideCancelReconcile({ kind: "not_found" });
    expect(att.action === "attention" && att.note).toBe(NOT_FOUND_NOTE);
    expect(Object.keys(decideCancelReconcile(tracked("canceled")))).toEqual(["action"]);
    expect(Object.keys(decideCancelReconcile({ kind: "down" }))).toEqual(["action"]);
  });

  it("isNotFoundReply: the measured vendor text and a 404 — and NOT the sandbox's 'Tracking tidak tersedia'", () => {
    expect(isNotFoundReply(200, "Paket tidak ditemukan")).toBe(true);
    expect(isNotFoundReply(404, undefined)).toBe(true);
    expect(isNotFoundReply(200, "Order not found")).toBe(true);
    // The normal post-booking state (no movement yet) must read as `down` → wait, never as gone.
    expect(isNotFoundReply(200, "Tracking tidak tersedia")).toBe(false);
    expect(isNotFoundReply(500, undefined)).toBe(false);
  });
});

// ── ② The decision is consulted where it must be ─────────────────────────────────────────────────
const read = (rel: string) => codeOnly(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"));

describe("the reconciler is wired, not decorative", () => {
  const sync = read("./ka-tracking.ts");
  const route = read("../app/api/cron/tracking/route.ts");

  it("syncOrderFromKa consults decideCancelReconcile BEFORE the forward status mapping", () => {
    const decide = sync.search(/decideCancelReconcile\s*\(/);
    const forward = sync.search(/RANK\s*\[\s*target\s*\]\s*>\s*RANK\s*\[\s*cur\s*\]/);
    expect(decide).toBeGreaterThan(-1);
    expect(forward).toBeGreaterThan(-1);
    expect(decide).toBeLessThan(forward);
  });

  it("a confirmed void writes `voided`, clears the provider ids and goes to `diproses` — never `batal`", () => {
    const start = sync.search(/decision\s*\.\s*action\s*===\s*"void"/);
    const end = sync.search(/decision\s*\.\s*action\s*===\s*"attention"/);
    expect(start).toBeGreaterThan(-1);
    const block = sync.slice(start, end);
    expect(block).toMatch(/status\s*:\s*"voided"/);
    expect(block).toMatch(/voidedAt\s*:/);
    expect(block).toMatch(/awb\s*:\s*null\s*,\s*kaOrderId\s*:\s*null/);
    expect(block).toMatch(/status\s*:\s*"diproses"/);
    expect(block).not.toMatch(/"batal"/);
    // and it stops there: the forward mapping (300 → batal) must not run after a void.
    expect(block).toMatch(/return\s*;/);
  });

  it("the poller feeds `not_found` to the reconciler on a failed pull — the one branch a healthy pull cannot produce", () => {
    expect(route).toMatch(/pendingCancel\s*&&\s*isNotFoundReply\s*\(/);
    expect(route).toMatch(/syncOrderFromKa\s*\(\s*o\s*\.\s*number\s*,\s*null\s*,\s*null\s*,\s*null\s*,\s*\{\s*kind\s*:\s*"not_found"\s*\}\s*\)/);
    // The flag comes from the booking row. This is a claim about RAW SQL inside a `sql` template —
    // Postgres executes it — so it is read with `textWithoutComments`, not `codeOnly` (which inerts
    // every literal; the repo rule, `inventory-location.test.ts`).
    const sqlText = textWithoutComments(readFileSync(fileURLToPath(new URL("../app/api/cron/tracking/route.ts", import.meta.url)), "utf8"));
    expect(sqlText).toMatch(/b\.status\s*=\s*'cancellation_requested'/);
  });
});

// ── ③ Real Postgres ──────────────────────────────────────────────────────────────────────────────
// `ka-tracking.ts` opens the root pool at import, so it is imported dynamically after DATABASE_URL is
// pointed at the `*_test` database (the ledger-credit / commerce-lifecycle pattern). Rows are
// COMMITTED by the function under test (it owns its own transaction), so the suite seeds under a
// run id and deletes everything it made in `afterAll`.
const URL_ = process.env.TEST_DATABASE_URL;
const suite = URL_ ? describe : describe.skip;
const runId = randomUUID().slice(0, 8);

let client: Sql;
let syncOrderFromKa: typeof import("./ka-tracking").syncOrderFromKa;
let accountId = "";
let storeId = "";
let seq = 0;

type Seeded = { orderId: string; number: string; bookingId: string };
async function seedPending(orderStatus: "diproses" | "dikirim", bookingStatus = "cancellation_requested"): Promise<Seeded> {
  const n = `CR-${runId}-${++seq}`;
  const [o] = await client<{ id: string }[]>`
    insert into orders (store_id, number, status, ka_order_id, awb, courier, service_type)
    values (${storeId}, ${n}, ${orderStatus}::order_status, ${`5758-${n}`}, ${`AWB${n}`}, 'spx', '1') returning id`;
  const [b] = await client<{ id: string }[]>`
    insert into shipment_bookings (store_id, order_id, provider_reference, courier, service_type, service_name, status, accepted_at)
    values (${storeId}, ${o.id}, ${`TOKOPHI-${n}`}, 'spx', '1', 'SPX Standard', ${bookingStatus}::shipment_booking_status, now()) returning id`;
  return { orderId: o.id, number: n, bookingId: b.id };
}
const readBack = async (s: Seeded) => {
  const [o] = await client<{ status: string; ka_order_id: string | null; awb: string | null; problem_at: Date | null; problem_note: string | null }[]>`
    select status, ka_order_id, awb, problem_at, problem_note from orders where id = ${s.orderId}`;
  const [b] = await client<{ status: string; voided_at: Date | null; failure_note: string | null }[]>`
    select status, voided_at, failure_note from shipment_bookings where id = ${s.bookingId}`;
  return { order: o, booking: b };
};

beforeAll(async () => {
  if (!URL_) return;
  process.env.DATABASE_URL = URL_;
  client = postgres(URL_, { max: 2 });
  ({ syncOrderFromKa } = await import("./ka-tracking"));
  const [acc] = await client<{ id: string }[]>`insert into accounts (name) values (${`CR ${runId}`}) returning id`;
  accountId = acc.id;
  const [st] = await client<{ id: string }[]>`
    insert into stores (account_id, name, slug, status, approved_at)
    values (${accountId}, ${`CR ${runId}`}, ${`cr-${runId}`}, 'active', now()) returning id`;
  storeId = st.id;
});

afterAll(async () => {
  if (!client) return;
  try {
    await client`delete from ledger_entries where store_id = ${storeId}`;
    await client`delete from shipment_bookings where store_id = ${storeId}`;
    await client`delete from orders where store_id = ${storeId}`;
    await client`delete from stores where id = ${storeId}`;
    await client`delete from accounts where id = ${accountId}`;
  } finally {
    await client.end();
  }
});

suite("syncOrderFromKa — a pending cancellation is reconciled from the courier's answer", () => {
  it("void: 300/302 on a `dikirim` order → booking voided, provider ids cleared, order back to `diproses` (NOT batal)", async () => {
    const s = await seedPending("dikirim");
    const r = await syncOrderFromKa(s.number, "canceled", null);
    expect(r.ok).toBe(true);
    expect(r.changed).toContain("cancel:voided");
    expect(r.changed).toContain("status:dikirim→diproses");
    const { order, booking } = await readBack(s);
    expect(booking.status).toBe("voided");
    expect(booking.voided_at).not.toBeNull();
    expect(order.status).toBe("diproses");
    expect(order.ka_order_id).toBeNull();
    expect(order.awb).toBeNull();
  });

  it("void on a `diproses` order: booking voided, status unchanged, and nothing else moved", async () => {
    const s = await seedPending("diproses");
    const r = await syncOrderFromKa(s.number, "canceled", null);
    expect(r.changed).toEqual(["cancel:voided"]);
    const { order, booking } = await readBack(s);
    expect(booking.status).toBe("voided");
    expect(order.status).toBe("diproses");
    expect(order.ka_order_id).toBeNull();
    // No ledger row was written by the void: a confirmed void is not a confirmed refund.
    const [{ n }] = await client<{ n: string }[]>`select count(*)::int as n from ledger_entries where order_id = ${s.orderId}`;
    expect(Number(n)).toBe(0);
  });

  it("revert: the parcel was picked up anyway → booking back to `accepted`, and the ordinary mapping still advances the order", async () => {
    const s = await seedPending("diproses");
    const r = await syncOrderFromKa(s.number, "shipped", `AWB-real-${s.number}`);
    expect(r.changed).toContain("cancel:reverted");
    expect(r.changed).toContain("status:diproses→dikirim");
    const { order, booking } = await readBack(s);
    expect(booking.status).toBe("accepted");
    expect(booking.failure_note).toMatch(/tidak terlaksana/);
    expect(order.status).toBe("dikirim");
    expect(order.ka_order_id).not.toBeNull();
  });

  it("attention: vendor says not found → booking stays pending, the order carries the problem flag", async () => {
    const s = await seedPending("diproses");
    const r = await syncOrderFromKa(s.number, null, null, null, { kind: "not_found" });
    expect(r.changed).toEqual(["cancel:attention"]);
    const { order, booking } = await readBack(s);
    expect(booking.status).toBe("cancellation_requested");
    expect(order.problem_at).not.toBeNull();
    expect(order.problem_note).toBe(NOT_FOUND_NOTE);
    // Idempotent: a second tick refreshes the note but does not re-age the flag.
    const firstAt = order.problem_at;
    await syncOrderFromKa(s.number, null, null, null, { kind: "not_found" });
    expect((await readBack(s)).order.problem_at?.getTime()).toBe(firstAt?.getTime());
  });

  it("wait: still at origin (booked) → nothing written", async () => {
    const s = await seedPending("diproses");
    const r = await syncOrderFromKa(s.number, "booked", null);
    expect(r.changed).toEqual([]);
    const { order, booking } = await readBack(s);
    expect(booking.status).toBe("cancellation_requested");
    expect(order.status).toBe("diproses");
  });

  it("no pending cancellation: 300 still means `batal` — the courier-side cancel nobody asked for is unchanged", async () => {
    const s = await seedPending("dikirim", "accepted");
    const r = await syncOrderFromKa(s.number, "canceled", null);
    expect(r.changed).toContain("status:dikirim→batal");
    const { order, booking } = await readBack(s);
    expect(order.status).toBe("batal");
    expect(booking.status).toBe("accepted");
  });
});
