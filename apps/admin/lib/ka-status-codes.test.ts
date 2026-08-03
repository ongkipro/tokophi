import { describe, it, expect, beforeAll } from "vitest";
import type { KaOutcome } from "./ka-tracking";

// `ka-tracking.ts` imports { db, schema } from @tokophi/db as VALUES, which initialises the DB client
// at import time and throws when DATABASE_URL is unset (the same hazard ledger-credit.test.ts
// documents). The function under test is PURE, so this suite must not need a database to run — it
// would be the only reason a status-table guard could go red. postgres-js connects lazily, so a
// placeholder URL satisfies the import-time check and opens no socket: nothing here ever queries.
let outcomeFromTrackingCode: (raw: number | string | null | undefined) => KaOutcome | null;
beforeAll(async () => {
  process.env.DATABASE_URL ||= "postgresql://unused:unused@127.0.0.1:1/unused";
  ({ outcomeFromTrackingCode } = await import("./ka-tracking"));
});

// The vendor's status table, transcribed from KiriminAja's "Status Code" page (important-notes/
// status-mapping) — every code it documents, with the outcome we intend for it. This suite exists
// because five codes were silently unmapped: a status the courier really sends that we really did
// not understand returned `null`, which fills the AWB and changes nothing.
//
// Two of the five — 333 (destroyed by courier) and 555 (confiscated by Customs) — are documented
// FINAL states. Unmapped, they left the order at `dikirim` and the poller re-queued it every 15
// minutes forever; the sweep takes a bounded batch per tick, so parcels that can never resolve pile
// up at the head of the queue and starve the ones with work outstanding. A third, 311, is the COD
// refusal ("recipient unwilling to pay") — the money path.
//
// `null` here is a DELIBERATE "changes nothing", not an oversight — see the tail of this table.
const DOCUMENTED: [code: number, outcome: KaOutcome | null, meaning: string][] = [
  // ── Entry state ────────────────────────────────────────────────────────────────────────────
  [100, "booked", "new package created by client"],
  [101, "booked", "pickup requested"],
  [102, "booked", "validated by pickup officer"],
  [103, "booked", "picked up by KiriminAja driver"],
  [104, "booked", "received and validated at KiriminAja DC"],
  [105, "booked", "waiting for 3PL pickup / awaiting AWB"],
  // ── Shipment state ─────────────────────────────────────────────────────────────────────────
  [106, "shipped", "with courier / in transit"],
  [107, "shipped", "reported by driver"],
  [110, "booked", "PENDING direct pickup — not collected yet"],
  [152, "shipped", "re-delivery / undelivery"],
  [301, "returned", "recipient refused the package"],
  [302, "canceled", "pickup canceled by seller"],
  [310, "returned", "rejected — recipient did not order"],
  [311, "returned", "rejected — recipient unwilling to pay (COD refusal)"],
  [333, "problem", "destroyed by courier (also a FINAL state)"],
  [401, "returned", "return information from DC"],
  [402, "returned", "arrived at KiriminAja warehouse"],
  [403, "returned", "return request initiated"],
  [404, "returned", "courier requested return delivery to seller"],
  [405, "returned", "return package rejected by seller"],
  [406, "returned", "return package breach"],
  [500, "problem", "package has issues"],
  [555, "problem", "confiscated by Customs (also a FINAL state)"],
  [701, "problem", "package lost"],
  [702, "problem", "package damaged"],
  [901, "problem", "problematic package pickup"],
  [902, "problem", "package issue at KiriminAja warehouse"],
  [903, "problem", "issue on courier's side"],
  [904, "problem", "return has issues"],
  [905, "problem", "package data incomplete (Excel import)"],
  // ── Final state ────────────────────────────────────────────────────────────────────────────
  [200, "delivered", "delivered to recipient"],
  [300, "canceled", "canceled by client"],
  [400, "returned", "successfully returned"],
  [703, "problem", "lost package claim resolved"],
  [704, "problem", "damaged package claim resolved"],
  // ── Deliberately NOT mapped ────────────────────────────────────────────────────────────────
  // 210/211 are a violation and its resolution. Flagging 210 as a problem without a path that
  // lowers the flag on 211 would leave a resolved violation reading as stuck forever.
  [210, null, "SOP violation / over SLA — a flag we cannot yet clear"],
  [211, null, "violation resolved"],
  // 350 is a cancellation REQUEST, not a granted cancellation; the courier may still collect.
  [350, null, "pickup cancellation requested"],
];

describe("outcomeFromTrackingCode — the documented KiriminAja status table", () => {
  for (const [code, expected, meaning] of DOCUMENTED) {
    it(`${code} (${meaning}) → ${expected ?? "no change"}`, () => {
      expect(outcomeFromTrackingCode(code)).toBe(expected);
      // The poller has seen `status` arrive as a string as well as a number; both spellings of the
      // same code must land on the same outcome or the mapping depends on the response's whims.
      expect(outcomeFromTrackingCode(String(code))).toBe(expected);
    });
  }

  it("maps every FINAL-state code to something the merchant can see", () => {
    // 200/300/400 move the order; 333/500/555/703/704 raise the problem flag. What must NEVER
    // happen is a final state returning null — that is an order the poller can never retire.
    const FINAL = [200, 300, 333, 400, 500, 555, 703, 704];
    const invisible = FINAL.filter((c) => outcomeFromTrackingCode(c) === null);
    expect(invisible).toEqual([]);
  });

  it("never infers a money-moving outcome from free text", () => {
    // Delivery, return, cancellation and problems all move stock, the ledger or COD cash. Text is
    // best-effort and unversioned, so it may only ever carry an order forward to `shipped`.
    const MONEY: (KaOutcome | null)[] = ["delivered", "returned", "canceled", "problem"];
    for (const s of ["sampai di kota tujuan", "selesai", "delivered", "batal", "retur", "hilang", "rusak"]) {
      expect(MONEY).not.toContain(outcomeFromTrackingCode(s));
    }
  });

  it("treats an unknown code as 'changes nothing', never as a guess", () => {
    for (const c of [0, 99, 999, 1234]) expect(outcomeFromTrackingCode(c)).toBeNull();
    for (const v of [null, undefined, "", "   "]) expect(outcomeFromTrackingCode(v)).toBeNull();
  });
});
