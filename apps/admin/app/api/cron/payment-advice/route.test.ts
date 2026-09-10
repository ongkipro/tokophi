import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { codeOnly } from "../../../../../../test/source-code";

process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL ?? "postgresql://none:none@127.0.0.1:1/none";

// The advice cron is OBSERVE-ONLY. These pin the three things that make that true and useful:
// it asks once per live bill (bounded), it tallies exactly what the provider said, and it never
// touches payment state — by source, not by hoping the mock stays quiet.

const h = vi.hoisted(() => ({
  payments: [] as { id: string; trxId: string | null; storeId: string }[],
  invoices: [] as { id: string; trxId: string | null; storeId: string }[],
  advice: new Map<string, { ok: boolean; rc: string; ket: string; error?: string }>(),
  asked: [] as string[],
  updates: 0,
  runs: [] as { job: string; ok: boolean; result: Record<string, unknown> }[],
}));

vi.mock("@tokophi/db", () => {
  const payments = { __t: "payments", id: "id", trxId: "trxId", storeId: "storeId", status: "status", method: "method" };
  const invoices = { __t: "invoices", id: "id", trxId: "trxId", storeId: "storeId", status: "status" };
  const chain = (table: { __t: string }) => {
    const rows = table.__t === "payments" ? h.payments : h.invoices;
    const q = {
      where: () => q,
      orderBy: () => q,
      limit: (n: number) => Promise.resolve(rows.slice(0, n)),
    };
    return q;
  };
  return {
    schema: { payments, invoices },
    db: {
      select: () => ({ from: (t: { __t: string }) => chain(t) }),
      update: () => { h.updates += 1; throw new Error("update must never be called"); },
    },
  };
});
vi.mock("@tokophi/lib/autolaris", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tokophi/lib/autolaris")>();
  return {
    ...actual,
    autolarisConfigured: () => true,
    alAdvice: vi.fn(async (trx: string) => { h.asked.push(trx); return h.advice.get(trx) ?? { ok: false, rc: "", ket: "", error: "no stub" }; }),
  };
});
vi.mock("../record-run", () => ({
  cronIntervalSec: () => 900,
  recordCronRun: vi.fn(async (job: string, o: { ok: boolean; result: Record<string, unknown> }) => { h.runs.push({ job, ok: o.ok, result: o.result }); }),
}));

const SECRET = "test-cron-secret";
const req = (secret?: string) => new NextRequest("http://localhost/api/cron/payment-advice?every=900", { headers: secret ? { "x-cron-secret": secret } : {} });

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  h.payments = []; h.invoices = []; h.advice.clear(); h.asked = []; h.updates = 0; h.runs = [];
});
afterEach(() => vi.clearAllMocks());

describe("GET /api/cron/payment-advice", () => {
  it("fails closed without the header credential", async () => {
    const { GET } = await import("./route");
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(h.asked).toEqual([]);
  });

  it("asks advice once per live prepaid bill and tallies the exact answers", async () => {
    h.payments = [{ id: "p1", trxId: "870161", storeId: "s" }, { id: "p2", trxId: "965568", storeId: "s" }];
    h.invoices = [{ id: "i1", trxId: "910957", storeId: "s" }];
    // the three answers measured live on 2026-09-09, plus a deceptive word and a transport failure
    h.advice.set("870161", { ok: true, rc: "02", ket: "FAILED" });
    h.advice.set("965568", { ok: true, rc: "00", ket: "SUCCESS" });
    h.advice.set("910957", { ok: false, rc: "", ket: "", error: "timeout" });
    const { GET } = await import("./route");
    const res = await GET(req(SECRET));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(h.asked.sort()).toEqual(["870161", "910957", "965568"]);
    expect(body.scanned).toBe(3);
    expect(body.asked).toBe(2);
    expect(body.transportErrors).toBe(1);
    expect(body.outcomes).toEqual({ paid: 0, pending: 0, failed: 1, unknown: 1 });
    expect(body.answers).toEqual({ "rc=02 ket=FAILED": 1, "rc=00 ket=SUCCESS": 1 });
    expect(body.sample.map((s: { trxId: string; outcome: string }) => [s.trxId, s.outcome])).toEqual([["870161", "failed"], ["965568", "unknown"]]);
    expect(h.runs).toEqual([expect.objectContaining({ job: "payment-advice", ok: true })]);
  });

  it("is bounded: never more than MAX_PER_TICK calls in one tick", async () => {
    h.payments = Array.from({ length: 60 }, (_, i) => ({ id: `p${i}`, trxId: `t${i}`, storeId: "s" }));
    for (let i = 0; i < 60; i++) h.advice.set(`t${i}`, { ok: true, rc: "02", ket: "PENDING" });
    const { GET } = await import("./route");
    await GET(req(SECRET));
    expect(h.asked.length).toBe(40);
  });

  it("writes nothing to payment state, whatever the provider says", async () => {
    h.payments = [{ id: "p1", trxId: "x", storeId: "s" }];
    h.advice.set("x", { ok: true, rc: "00", ket: "PAID" }); // deceptive by classifier: unknown
    const { GET } = await import("./route");
    const body = await (await GET(req(SECRET))).json();
    expect(body.outcomes.unknown).toBe(1);
    expect(h.updates).toBe(0);
  });
});

// The mock above proves no update ran; this proves no update CAN run — the source has no writer.
describe("the route's source contains no writer of payment state", () => {
  const src = codeOnly(readFileSync(new URL("./route.ts", import.meta.url), "utf8"));
  it("never updates payments/invoices/orders and never credits the ledger", () => {
    const writer = /\.\s*update\s*\(|creditSaleForPayment|applyOrderStatusChange|\.\s*insert\s*\(\s*schema\s*\.\s*(payments|invoices|orders)/;
    expect(src).not.toMatch(writer);
    expect(codeOnly("await db.update(schema.payments).set({ status: 'berhasil' })")).toMatch(writer); // mutation self-check
  });
});
