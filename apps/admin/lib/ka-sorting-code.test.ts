import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { codeOnly } from "../../../test/source-code";

// `orders.sorting_code` (0110) has ONE writer, `syncOrderFromKa`. Real Postgres, because every claim
// is about what lands in the row: written with a waybill, never without one, replaced with a new
// waybill, never cleared by silence, cleared with a confirmed void. Rows are committed by the function
// under test, so the suite seeds under a run id and deletes what it made (cancel-reconcile's pattern).
const URL_ = process.env.TEST_DATABASE_URL;
const suite = URL_ ? describe : describe.skip;
const runId = randomUUID().slice(0, 8);

let client: Sql;
let syncOrderFromKa: typeof import("./ka-tracking").syncOrderFromKa;
let clearStaleTrackingRejection: typeof import("./ka-tracking").clearStaleTrackingRejection;
let accountId = "";
let storeId = "";
let seq = 0;

async function seed(opts: { awb: string | null; sortingCode?: string | null; booking?: string }) {
  const n = `SC-${runId}-${++seq}`;
  const [o] = await client<{ id: string }[]>`
    insert into orders (store_id, number, status, ka_order_id, awb, sorting_code, courier, service_type)
    values (${storeId}, ${n}, 'diproses'::order_status, ${`5758-${n}`}, ${opts.awb}, ${opts.sortingCode ?? null}, 'spx', '1') returning id`;
  if (opts.booking) {
    await client`
      insert into shipment_bookings (store_id, order_id, provider_reference, courier, service_type, service_name, status, accepted_at)
      values (${storeId}, ${o.id}, ${`TOKOPHI-${n}`}, 'spx', '1', 'SPX Standard', ${opts.booking}::shipment_booking_status, now())`;
  }
  return { id: o.id, number: n };
}
const read = async (id: string) =>
  (await client<{ awb: string | null; sorting_code: string | null }[]>`select awb, sorting_code from orders where id = ${id}`)[0];

beforeAll(async () => {
  if (!URL_) return;
  process.env.DATABASE_URL = URL_;
  client = postgres(URL_, { max: 2 });
  ({ syncOrderFromKa, clearStaleTrackingRejection } = await import("./ka-tracking"));
  const [acc] = await client<{ id: string }[]>`insert into accounts (name) values (${`SC ${runId}`}) returning id`;
  accountId = acc.id;
  const [st] = await client<{ id: string }[]>`
    insert into stores (account_id, name, slug, status, approved_at) values (${accountId}, ${`SC ${runId}`}, ${`sc-${runId}`}, 'active', now()) returning id`;
  storeId = st.id;
});

afterAll(async () => {
  if (!client) return;
  try {
    await client`delete from shipment_bookings where store_id = ${storeId}`;
    await client`delete from orders where store_id = ${storeId}`;
    await client`delete from stores where id = ${storeId}`;
    await client`delete from accounts where id = ${accountId}`;
  } finally {
    await client.end();
  }
});

suite("syncOrderFromKa — orders.sorting_code", () => {
  it("writes the code together with the waybill it belongs to", async () => {
    const s = await seed({ awb: null });
    const r = await syncOrderFromKa(s.number, "booked", "SPXAWB-1", null, undefined, "JOG-JOG1000-JKT2010");
    expect(r.changed).toEqual(expect.arrayContaining(["awb:SPXAWB-1", "sorting:JOG-JOG1000-JKT2010"]));
    expect(await read(s.id)).toEqual({ awb: "SPXAWB-1", sorting_code: "JOG-JOG1000-JKT2010" });
  });

  it("fills the code later for the same waybill", async () => {
    const s = await seed({ awb: "SPXAWB-2" });
    const r = await syncOrderFromKa(s.number, null, "SPXAWB-2", null, undefined, "JOG-A");
    expect(r.changed).toEqual(["sorting:JOG-A"]);
    expect((await read(s.id)).sorting_code).toBe("JOG-A");
  });

  it("never writes a code with no waybill to attach it to", async () => {
    const s = await seed({ awb: null });
    const r = await syncOrderFromKa(s.number, null, null, null, undefined, "JOG-A");
    expect(r.changed).toEqual([]);
    expect((await read(s.id)).sorting_code).toBeNull();
  });

  it("is not CLEARED by a later pull that simply omits it", async () => {
    const s = await seed({ awb: "SPXAWB-3", sortingCode: "JOG-KEEP" });
    await syncOrderFromKa(s.number, "shipped", "SPXAWB-3", null, undefined, null);
    expect((await read(s.id)).sorting_code).toBe("JOG-KEEP");
  });

  it("goes with the old waybill when a NEW one replaces it", async () => {
    const s = await seed({ awb: "SPXAWB-OLD", sortingCode: "JOG-OLD" });
    await syncOrderFromKa(s.number, null, "SPXAWB-NEW", null, undefined, null);
    expect(await read(s.id)).toEqual({ awb: "SPXAWB-NEW", sorting_code: null });
  });

  it("refuses a malformed code at the writer, whatever the caller passed", async () => {
    const s = await seed({ awb: "SPXAWB-4" });
    const r = await syncOrderFromKa(s.number, null, "SPXAWB-4", null, undefined, "<b>JOG</b>");
    expect(r.changed).toEqual([]);
    expect((await read(s.id)).sorting_code).toBeNull();
  });

  it("is cleared with the waybill on a confirmed void", async () => {
    const s = await seed({ awb: "SPXAWB-5", sortingCode: "JOG-VOID", booking: "cancellation_requested" });
    const r = await syncOrderFromKa(s.number, "canceled", null);
    expect(r.changed).toContain("cancel:voided");
    expect(await read(s.id)).toEqual({ awb: null, sorting_code: null });
  });
});

// A "permanent rejection" flag the vendor has since stopped earning (audit 2026-09-14). The first
// note is the literal production text from the 2026-09-07 allow-list lapse, brand and all.
suite("clearStaleTrackingRejection — lowers a permanent-rejection flag once the vendor answers, and nothing else", () => {
  const flag = async (note: string | null) => {
    const s = await seed({ awb: null });
    await client`update orders set problem_at = ${note ? new Date("2026-08-27T05:11:25Z") : null}, problem_note = ${note} where id = ${s.id}`;
    return s;
  };
  const state = async (id: string) =>
    (await client<{ problem_at: Date | null; problem_note: string | null }[]>`select problem_at, problem_note from orders where id = ${id}`)[0];

  it("clears the note the allow-list lapse wrote, in its pre-rename branded form", async () => {
    const s = await flag("KiriminAja menolak permintaan pelacakan secara permanen (HTTP 401): Your IP address 45.77.33.112 were not allowed to access this API. #1");
    expect(await clearStaleTrackingRejection(s.number)).toBe(true);
    expect(await state(s.id)).toEqual({ problem_at: null, problem_note: null });
  });

  it("clears the current, unbranded form too", async () => {
    const s = await flag("TokoΦ Kirim menolak permintaan pelacakan secara permanen (HTTP 403).");
    expect(await clearStaleTrackingRejection(s.number)).toBe(true);
  });

  it("leaves a courier-reported obstacle alone — that is not a rejection", async () => {
    const note = "Kurir melaporkan kendala pengiriman (kode 500). Hubungi kurir atau pembeli untuk memastikan paket.";
    const s = await flag(note);
    expect(await clearStaleTrackingRejection(s.number)).toBe(false);
    expect((await state(s.id)).problem_note).toBe(note);
  });

  it("is a no-op on an order with no flag", async () => {
    const s = await flag(null);
    expect(await clearStaleTrackingRejection(s.number)).toBe(false);
  });
});

// The webhook half. `verifyKaHint` needs a live tracking pull, so the binding RULE is table-tested in
// `packages/lib/src/kiriminaja-tracking.test.ts`; what is pinned here is that the receiver and the
// verifier are still wired to it — read as CODE, never as text (test/source-code.ts).
describe("the webhook passes the row as a hint, and the verifier binds it to the verified waybill", () => {
  const src = (p: string) => codeOnly(readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8"));

  it("the receiver hands the row's awb and sorting_code to verifyKaHint and writes nothing itself", () => {
    const route = src("../app/api/public/kiriminaja/webhook/route.ts");
    expect(route).toMatch(/verifyKaHint\s*\(\s*id\s*,\s*\{\s*awb\s*:\s*r0\s*\?\.\s*awb\s*,\s*sortingCode\s*:\s*r0\s*\?\.\s*sorting_code\s*\}\s*\)/);
    expect(route).not.toMatch(/\.update\s*\(|\.insert\s*\(/);
  });

  it("the verifier prefers the pull's code and otherwise accepts only a hint bound to the verified awb", () => {
    const pattern =
      /t\s*\.\s*sortingCode\s*\?\?\s*sortingCodeFromHint\s*\(\s*\{\s*hintAwb\s*:\s*hint\s*\?\.\s*awb\s*,\s*hintSortingCode\s*:\s*hint\s*\?\.\s*sortingCode\s*,\s*verifiedAwb\s*:\s*realAwb\s*\?\?\s*realWaybill\s*\(\s*order\s*\.\s*awb\s*,\s*kaOrderId\s*\)\s*\}\s*\)/;
    expect(src("./ka-tracking.ts")).toMatch(pattern);
    // Mutation self-check: the UNBOUND form (believe the body) must not satisfy the pattern.
    expect(codeOnly("const sortingCode = t.sortingCode ?? normalizeSortingCode(hint?.sortingCode);")).not.toMatch(pattern);
  });

  it("every consumer decides 'is this a waybill' through realWaybill, never a bare `!== ref`", () => {
    const uses = /realAwb\s*=\s*realWaybill\s*\(\s*t\s*\.\s*awb\s*,/;
    const bare = /t\s*\.\s*awb\s*!==/;
    for (const p of ["./ka-tracking.ts", "./actions/shipping.ts", "../app/api/cron/tracking/route.ts"]) {
      expect(src(p), p).toMatch(uses);
      expect(src(p), p).not.toMatch(bare);
    }
    // Mutation self-check: the old form trips `bare` and does not satisfy `uses`.
    const old = codeOnly("const realAwb = t.awb && t.awb !== ref ? t.awb : null;");
    expect(old).toMatch(bare);
    expect(old).not.toMatch(uses);
  });

  it("the poller lowers a stale rejection on ANY 2xx answer, before the ok/failed split", () => {
    const route = src("../app/api/cron/tracking/route.ts");
    const clear = route.search(/clearStaleTrackingRejection\s*\(\s*o\s*\.\s*number\s*\)/);
    const split = route.search(/if\s*\(\s*!\s*r\s*\.\s*ok\s*\)/);
    expect(clear).toBeGreaterThan(0);
    expect(split).toBeGreaterThan(0);
    expect(clear).toBeLessThan(split);
    // The scanner emits `>=` as `> =`, hence `>\s*=`.
    expect(route).toMatch(/r\s*\.\s*httpStatus\s*>\s*=\s*200\s*&&\s*r\s*\.\s*httpStatus\s*<\s*300/);
    // The note the poller WRITES carries the mark the clearer MATCHES — one constant, not two strings.
    expect(route).toMatch(/const\s+note\s*=[^;]*TRACKING_REJECTION_MARK/);
    expect(route).not.toMatch(/menolak\s*permintaan/);
  });

  it("no consumer reads the tracking envelope's nonexistent `data` key any more", () => {
    const pattern = /r\s*\.\s*data\b/;
    for (const p of ["./ka-tracking.ts", "./actions/shipping.ts", "../app/api/cron/tracking/route.ts"]) {
      expect(src(p), p).not.toMatch(pattern);
    }
    // Mutation self-check: the old reader must trip it.
    expect(codeOnly("const data = (r.data ?? {}) as { awb?: string };")).toMatch(pattern);
  });
});
