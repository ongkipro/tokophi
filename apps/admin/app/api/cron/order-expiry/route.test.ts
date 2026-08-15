import type * as DbModule from "@tokophi/db";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

process.env.DATABASE_URL ??=
  process.env.TEST_DATABASE_URL ?? "postgresql://none:none@127.0.0.1:1/none";

type LockedOrder = {
  id: string;
  storeId: string;
  status: "baru" | "diproses" | "dikirim" | "selesai" | "batal" | "retur";
  financialStatus: "pending" | "dibayar" | "refund_sebagian" | "refund";
  placedAt: Date;
};
type Payment = {
  method: "transfer" | "qris" | "ovo" | "gopay" | "dana" | "va" | "cod";
  status: "menunggu" | "berhasil" | "gagal";
};
type TxCase = {
  order?: LockedOrder;
  payments?: Payment[];
  error?: Error;
  locks?: number;
};

const h = vi.hoisted(() => {
  const state = {
    candidates: [] as { id: string }[],
    txCases: [] as TxCase[],
    txSeen: [] as unknown[],
    applyResults: [] as ({ applied: boolean; reason?: string } | Error)[],
    intervalSec: 300 as number | null,
  };

  const query = (rows: unknown[], onLock?: () => void) => {
    const chain: Record<string, unknown> = {};
    chain.from = () => chain;
    chain.where = () => chain;
    chain.orderBy = () => chain;
    chain.for = () => {
      onLock?.();
      return chain;
    };
    chain.limit = async () => rows;
    chain.then = (
      resolve: (value: unknown[]) => unknown,
      reject: (reason: unknown) => unknown,
    ) => Promise.resolve(rows).then(resolve, reject);
    return chain;
  };

  const db = {
    select: vi.fn(() => query(state.candidates)),
    transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>) => {
      const current = state.txCases.shift();
      if (!current) throw new Error("Missing transaction fixture");
      if (current.error) throw current.error;

      let selectIndex = 0;
      const tx = {
        select: vi.fn(() => {
          const rows = selectIndex++ === 0
            ? current.order
              ? [current.order]
              : []
            : current.payments ?? [];
          return query(rows, () => {
            current.locks = (current.locks ?? 0) + 1;
          });
        }),
      };
      state.txSeen.push(tx);
      return run(tx);
    }),
  };

  const applyOrderStatusChange = vi.fn(async (_tx: unknown, _args: unknown) => {
    const result = state.applyResults.shift() ?? { applied: true };
    if (result instanceof Error) throw result;
    return result;
  });
  const recordCronRun = vi.fn(async () => undefined);
  const cronIntervalSec = vi.fn(() => state.intervalSec);

  return { state, db, applyOrderStatusChange, recordCronRun, cronIntervalSec };
});

vi.mock("@tokophi/db", async (importOriginal) => {
  const actual = await importOriginal<typeof DbModule>();
  return { ...actual, db: h.db };
});
vi.mock("@/lib/order-status", () => ({
  applyOrderStatusChange: h.applyOrderStatusChange,
}));
vi.mock("../record-run", () => ({
  cronIntervalSec: h.cronIntervalSec,
  recordCronRun: h.recordCronRun,
}));


const NOW = new Date("2026-08-15T12:00:00.000Z");
const old = (hours = 25) => new Date(NOW.getTime() - hours * 60 * 60 * 1000);
const order = (id: string, overrides: Partial<LockedOrder> = {}): LockedOrder => ({
  id,
  storeId: `store-${id}`,
  status: "baru",
  financialStatus: "pending",
  placedAt: old(),
  ...overrides,
});
const request = (secret = "cron-secret") =>
  new NextRequest("http://localhost/api/cron/order-expiry?every=300", {
    headers: { "x-cron-secret": secret },
  });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("CRON_SECRET", "cron-secret");
  vi.clearAllMocks();
  h.state.candidates = [];
  h.state.txCases = [];
  h.state.txSeen = [];
  h.state.applyResults = [];
  h.state.intervalSec = 300;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("GET /api/cron/order-expiry", () => {
  it("cancels every expired prepaid candidate through the state machine on the locking transaction", async () => {
    h.state.candidates = [{ id: "one" }, { id: "two" }];
    h.state.txCases = [
      { order: order("one"), payments: [{ method: "va", status: "menunggu" }] },
      { order: order("two"), payments: [{ method: "qris", status: "gagal" }] },
    ];

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      scanned: 2,
      cancelled: 2,
      skipped: 0,
      errors: 0,
    });
    expect(h.applyOrderStatusChange).toHaveBeenCalledTimes(2);
    expect(h.applyOrderStatusChange.mock.calls[0]).toEqual([
      h.state.txSeen[0],
      {
        storeId: "store-one",
        order: { id: "one", status: "baru" },
        status: "batal",
      },
    ]);
    expect(h.applyOrderStatusChange.mock.calls[1][0]).toBe(h.state.txSeen[1]);
    expect(h.state.txCases).toHaveLength(0);
    expect(h.recordCronRun).toHaveBeenCalledWith("order-expiry", {
      ok: true,
      startedAt: NOW.getTime(),
      intervalSec: 300,
      result: { scanned: 2, cancelled: 2, skipped: 0, errors: 0 },
    });
  });

  it("rechecks eligibility under locks and never cancels paid, COD, fresh, or no-longer-new orders", async () => {
    const cases: TxCase[] = [
      { order: order("paid"), payments: [{ method: "va", status: "berhasil" }] },
      { order: order("cod"), payments: [{ method: "cod", status: "menunggu" }] },
      { order: order("fresh", { placedAt: old(23) }), payments: [{ method: "va", status: "menunggu" }] },
      { order: order("advanced", { status: "diproses" }), payments: [{ method: "va", status: "menunggu" }] },
    ];
    h.state.candidates = cases.map((entry) => ({ id: entry.order!.id }));
    h.state.txCases = [...cases];

    const response = await GET(request());

    expect(await response.json()).toEqual({
      ok: true,
      scanned: 4,
      cancelled: 0,
      skipped: 4,
      errors: 0,
    });
    expect(h.applyOrderStatusChange).not.toHaveBeenCalled();
    // paid + COD lock order and payments; fresh + advanced stop after locking/re-reading the order.
    expect(cases.map((entry) => entry.locks)).toEqual([2, 2, 1, 1]);
  });

  it("continues after one order fails and records the run as unhealthy", async () => {
    h.state.candidates = [{ id: "broken" }, { id: "good" }];
    h.state.txCases = [
      { error: new Error("transaction failed") },
      { order: order("good"), payments: [{ method: "dana", status: "menunggu" }] },
    ];
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: false,
      scanned: 2,
      cancelled: 1,
      skipped: 0,
      errors: 1,
    });
    expect(consoleError).toHaveBeenCalledWith(
      "[cron/order-expiry] failed to expire order",
      "broken",
      expect.any(Error),
    );
    expect(h.recordCronRun).toHaveBeenCalledWith(
      "order-expiry",
      expect.objectContaining({
        ok: false,
        result: { scanned: 2, cancelled: 1, skipped: 0, errors: 1 },
      }),
    );
    consoleError.mockRestore();
  });

  it("fails closed in production when CRON_SECRET is missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CRON_SECRET", "");

    const response = await GET(request(""));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: "unauthorized" });
    expect(h.db.select).not.toHaveBeenCalled();
    expect(h.db.transaction).not.toHaveBeenCalled();
    expect(h.recordCronRun).not.toHaveBeenCalled();
  });
});
