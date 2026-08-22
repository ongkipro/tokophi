import type * as DbModule from "@tokophi/db";
import { signPayCallbackRef } from "@tokophi/lib/pay-callback";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

process.env.DATABASE_URL ??=
  process.env.TEST_DATABASE_URL ?? "postgresql://none:none@127.0.0.1:1/none";

/**
 * Task 4.13 / SEC-16 — the two halves this endpoint has to get right at the same time.
 *
 * 1. EXACTLY ONE IDENTITY. Zero identifiers and an ambiguous match are both refusals now, on the
 *    payment half AND on the subscription-invoice half. They used to be a silent `{ok:true}` and an
 *    unguarded multi-row update respectively.
 * 2. A REUSABLE CREDENTIAL ONLY VIA A HEADER — plus a per-payment SIGNATURE, which is bound to the
 *    row it names. The legacy `?token=` door stays open on purpose and is pinned here as such.
 *
 * The suite drives the real handler with real `Request`s. Only the database and the two money-side
 * effects are mocked; every auth and identity decision under test is the shipped code.
 */
const SECRET = "the-platform-callback-secret";

type Row = Record<string, unknown>;

const h = vi.hoisted(() => {
  const state = { selects: [] as Row[][], updates: [] as Row[][], selectCalls: 0 };

  const thenable = (rows: Row[]) => {
    const chain: Record<string, unknown> = {};
    for (const k of ["from", "where", "set", "limit", "returning", "values", "orderBy"]) {
      chain[k] = () => chain;
    }
    chain.then = (resolve: (v: Row[]) => unknown, reject: (r: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject);
    return chain;
  };

  const db = {
    select: vi.fn(() => {
      state.selectCalls += 1;
      return thenable(state.selects.shift() ?? []);
    }),
    update: vi.fn(() => thenable(state.updates.shift() ?? [])),
    insert: vi.fn(() => thenable([])),
  };
  return { state, db };
});

vi.mock("@tokophi/db", async (importOriginal) => {
  const actual = await importOriginal<typeof DbModule>();
  return { ...actual, db: h.db };
});
vi.mock("@/lib/ledger-credit", () => ({ creditSaleForPayment: vi.fn(async () => undefined) }));
vi.mock("@/lib/tracking-events", () => ({ releasePurchase: vi.fn(async () => undefined) }));
vi.mock("@tokophi/lib/cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tokophi/lib/cache")>();
  return { ...actual, rateLimit: () => ({ ok: true, remaining: 60 }) };
});

/** `?cb=` as `payCallbackUrl()` mints it. */
const signed = (ref: string) => `${ref}.${signPayCallbackRef(ref, SECRET)}`;

function callback(
  body: Record<string, unknown>,
  init: { header?: string; query?: string } = {},
): Request {
  return new Request(`https://app.tokophi.test/api/public/pay/callback${init.query ?? ""}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(init.header ? { "x-callback-token": init.header } : {}),
    },
    body: JSON.stringify(body),
  });
}

/** An EXPIRED callback is the shortest complete path: no order sync, no tracking, no ledger. */
const expired = (ref = "INV-4711") => ({ trx_id: "TRX-1", reff_id: ref, status: "EXPIRED" });

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("AUTOLARIS_CALLBACK_SECRET", SECRET);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  h.state.selects = [];
  h.state.updates = [];
  h.state.selectCalls = 0;
  h.db.select.mockClear();
  h.db.update.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/public/pay/callback — authentication", () => {
  it("accepts the shared secret in the x-callback-token header", async () => {
    h.state.selects = [[{ id: "p1", orderId: "o1", amountIdr: 125_000, reffId: "INV-4711" }], []];
    h.state.updates = [[{ id: "p1", orderId: "o1" }]];
    const res = await POST(callback(expired(), { header: SECRET }));
    expect(res.status).toBe(200);
  });

  it("accepts the per-payment signature we now mint, and binds it to the row it names", async () => {
    h.state.selects = [[{ id: "p1", orderId: "o1", amountIdr: 125_000, reffId: "INV-4711" }], []];
    h.state.updates = [[{ id: "p1", orderId: "o1" }]];
    const res = await POST(callback(expired(), { query: `?cb=${encodeURIComponent(signed("INV-4711"))}` }));
    expect(res.status).toBe(200);
  });

  it("🔴 a valid signature may NOT act on a payment it does not name", async () => {
    // The replay a bare "is this signed?" check would have allowed: one leaked callback URL, pointed
    // at somebody else's payment. The row resolved carries a different reff_id, so it is refused.
    h.state.selects = [[{ id: "p9", orderId: "o9", amountIdr: 9_000, reffId: "INV-9999" }]];
    const res = await POST(callback(expired(), { query: `?cb=${encodeURIComponent(signed("INV-4711"))}` }));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ ok: false });
    expect(h.db.update).not.toHaveBeenCalled();
  });

  it("🔴 the same binding protects a subscription invoice", async () => {
    h.state.selects = [
      [], // no payment row
      [{ id: "inv9", amountIdr: 305_250, reffId: "SUB-otherstore-77" }],
    ];
    const res = await POST(callback(expired(), { query: `?cb=${encodeURIComponent(signed("INV-4711"))}` }));
    expect(res.status).toBe(403);
    expect(h.db.update).not.toHaveBeenCalled();
  });

  it("rejects a tampered signature, a foreign secret, and the raw secret pasted into ?cb=", async () => {
    for (const query of [
      `?cb=${encodeURIComponent(`INV-4711.${"0".repeat(32)}`)}`,
      `?cb=${encodeURIComponent(`INV-4711.${signPayCallbackRef("INV-4711", "another-secret")}`)}`,
      `?cb=${encodeURIComponent(SECRET)}`,
      "?cb=",
    ]) {
      const res = await POST(callback(expired(), { query }));
      expect(res.status, query).toBe(401);
    }
    expect(h.db.select).not.toHaveBeenCalled();
  });

  it("rejects a callback carrying no credential at all", async () => {
    const res = await POST(callback(expired()));
    expect(res.status).toBe(401);
  });

  it("FAILS CLOSED in production when the secret is unset", async () => {
    vi.stubEnv("AUTOLARIS_CALLBACK_SECRET", "");
    vi.stubEnv("NODE_ENV", "production");
    const res = await POST(callback(expired(), { header: "anything" }));
    expect(res.status).toBe(401);
  });

  /**
   * 🔴 A KNOWINGLY-OPEN DOOR, PINNED WITH ITS REASON — do not "fix" this test by deleting it.
   *
   * AutoLaris echoes `callback_url` and attaches no headers of its own. Until the vendor confirms it
   * can send `X-Callback-Token` (or its own signature), refusing `?token=` would 401 every genuine
   * payment: the shopper pays, the order never reaches `dibayar`, and nobody finds out until a
   * merchant complains. What IS closed is the minting side — `payCallbackUrl()` no longer produces
   * one (see `packages/lib/src/pay-callback.test.ts`), so this door only serves bills raised before
   * that change plus whatever the vendor sends.
   *
   * When the vendor confirms the header, DELETE the `query-token` branch in `authorizeCallback` and
   * this test together — and the assertion below is what tells you the branch is really gone.
   */
  it("the legacy ?token= door still opens, and every use is logged as deprecated", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.state.selects = [[{ id: "p1", orderId: "o1", amountIdr: 125_000, reffId: "INV-4711" }], []];
    h.state.updates = [[{ id: "p1", orderId: "o1" }]];

    const res = await POST(callback(expired(), { query: `?token=${encodeURIComponent(SECRET)}` }));

    expect(res.status).toBe(200);
    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).toMatch(/DEPRECATED/);
    expect(logged).not.toContain(SECRET);
  });

  it("a WRONG query token is still a 401 — the door is legacy, not unlocked", async () => {
    const res = await POST(callback(expired(), { query: "?token=not-the-secret" }));
    expect(res.status).toBe(401);
  });
});

describe("POST /api/public/pay/callback — exactly one identity", () => {
  it("refuses a callback that names no payment, instead of answering ok", async () => {
    const res = await POST(callback({ status: "PAID", amount: 125_000 }, { header: SECRET }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "missing transaction identifier" });
    expect(h.db.select).not.toHaveBeenCalled();
  });

  it("treats a blank identifier as no identifier", async () => {
    const res = await POST(callback({ trx_id: "", reff_id: "   ", status: "PAID" }, { header: SECRET }));
    expect(res.status).toBe(400);
    expect(h.db.select).not.toHaveBeenCalled();
  });

  it("refuses an ambiguous payment match rather than updating several rows", async () => {
    h.state.selects = [[
      { id: "p1", orderId: "o1", amountIdr: 125_000, reffId: "INV-4711" },
      { id: "p2", orderId: "o2", amountIdr: 125_000, reffId: "INV-4712" },
    ]];
    const res = await POST(callback(expired(), { header: SECRET }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "ambiguous payment match" });
    expect(h.db.update).not.toHaveBeenCalled();
  });

  it("refuses an ambiguous SUBSCRIPTION INVOICE match — the half that had no guard at all", async () => {
    h.state.selects = [
      [], // no payment row
      [
        { id: "inv1", amountIdr: 305_250, reffId: "SUB-a-1" },
        { id: "inv2", amountIdr: 305_250, reffId: "SUB-b-1" },
      ],
    ];
    const res = await POST(callback(expired(), { header: SECRET }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "ambiguous invoice match" });
    expect(h.db.update).not.toHaveBeenCalled();
  });

  it("a status it does not map is a no-op, not an identity failure", async () => {
    const res = await POST(callback({ trx_id: "TRX-1", status: "PENDING" }, { header: SECRET }));
    expect(res.status).toBe(200);
    expect(h.db.select).not.toHaveBeenCalled();
  });
});
