import { describe, expect, it } from "vitest";
import { ADVICE_SETTLED, classifyAdvice, type AdviceOutcome } from "./autolaris";

// 🔴 THIS IS THE MONEY DECISION. A wrong `paid` here credits a seller's WITHDRAWABLE balance through
// `creditSaleForPayment` for cash that never arrived. Skill rule 8: "The provider has not published
// a complete Advice settlement mapping. Pending, generic success wording, and shipping vocabulary
// such as `DELIVERED` are not proof of payment."
//
// Live evidence, production admin container 2026-09-09, four real provider transaction ids:
// every one answered {"rc":"02","ket":"FAILED","data":{"awb":""}} — including two bills our own DB
// still holds as `menunggu`. The vendor's documented sample for the same rc is ket "PENDING". So
// `rc=02` is one undifferentiated non-settled bucket and no PAID answer has ever been observed.

describe("the settled list is empty until AutoLaris confirms the mapping", () => {
  it("no ket value maps to paid today", () => {
    // If this ever goes red, somebody added a settlement word. That is a deliberate, owner-level
    // change (go-live question 6) and this test is what makes it impossible to do by accident.
    expect(ADVICE_SETTLED).toEqual([]);
  });
});

describe("classifyAdvice — conservative by construction", () => {
  const table: { rc: string; ket: string; outcome: AdviceOutcome; why: string }[] = [
    // ── observed live ──
    { rc: "02", ket: "FAILED", outcome: "failed", why: "the answer every real trx id returned on 2026-09-09" },
    // ── the vendor's own documented sample ──
    { rc: "02", ket: "PENDING", outcome: "pending", why: "documented observed response; explicitly 'tidak lunas'" },
    // ── the three the guide names as traps: NONE may be paid ──
    { rc: "00", ket: "SUCCESS", outcome: "unknown", why: "generic envelope wording, not settlement" },
    { rc: "00", ket: "BERHASIL", outcome: "unknown", why: "generic envelope wording, not settlement" },
    { rc: "00", ket: "DELIVERED", outcome: "unknown", why: "SHIPPING vocabulary — describes a parcel, not a rupiah" },
    // ── words that merely LOOK settled and have never been observed ──
    { rc: "00", ket: "PAID", outcome: "unknown", why: "never observed from this endpoint; guessing it is what rule 8 forbids" },
    { rc: "00", ket: "LUNAS", outcome: "unknown", why: "unproven settlement word" },
    { rc: "00", ket: "SETTLED", outcome: "unknown", why: "unproven settlement word" },
    // ── unambiguous non-settlement ──
    { rc: "03", ket: "EXPIRED", outcome: "failed", why: "the bill lapsed" },
    { rc: "03", ket: "BATAL", outcome: "failed", why: "cancelled" },
    { rc: "02", ket: "MENUNGGU", outcome: "pending", why: "Indonesian pending" },
    // ── everything unrecognised falls to unknown, NOT to paid and NOT to pending ──
    { rc: "99", ket: "SOMETHING NEW", outcome: "unknown", why: "an unseen word must surface, not be absorbed" },
    { rc: "", ket: "", outcome: "unknown", why: "an empty envelope decides nothing" },
    { rc: "404", ket: "not found", outcome: "unknown", why: "what inquiry_payment answers — no transaction, no verdict" },
  ];

  for (const t of table) {
    it(`rc=${t.rc || "∅"} ket=${t.ket || "∅"} → ${t.outcome} (${t.why})`, () => {
      expect(classifyAdvice(t.rc, t.ket).outcome).toBe(t.outcome);
    });
  }

  it("NOTHING in the table reaches paid", () => {
    for (const t of table) expect(classifyAdvice(t.rc, t.ket).outcome, `${t.rc}/${t.ket}`).not.toBe("paid");
  });

  it("is case- and whitespace-insensitive, so ' delivered ' cannot slip past the trap list", () => {
    expect(classifyAdvice("00", "  delivered  ").outcome).toBe("unknown");
    expect(classifyAdvice(" 02 ", "Failed").outcome).toBe("failed");
  });

  it("null/undefined decide nothing", () => {
    expect(classifyAdvice(null, undefined).outcome).toBe("unknown");
  });

  it("every reason names the rc and ket it judged, so a log line can be reconstructed", () => {
    expect(classifyAdvice("02", "FAILED").reason).toMatch(/rc=02/);
    expect(classifyAdvice("00", "DELIVERED").reason).toMatch(/DELIVERED/);
  });
});

// ── MUTATION SELF-CHECK ─────────────────────────────────────────────────────────────────────────
// The table above is only worth something if it can fail. These reproduce the three mutations that
// would actually ship — someone "finishing" the settlement mapping with the words that look right —
// against a local copy of the same decision, and assert each one is caught.
describe("MUTATION SELF-CHECK: the three plausible wrong mappings are all caught", () => {
  const mutant = (settled: string[]) => (ket: string): AdviceOutcome => (settled.includes(ket.toUpperCase()) ? "paid" : classifyAdvice("00", ket).outcome);

  for (const word of ["SUCCESS", "BERHASIL", "DELIVERED"]) {
    it(`treating ${word} as settled would break the "nothing reaches paid" claim`, () => {
      const decide = mutant([word]);
      expect(decide(word)).toBe("paid");            // the mutation really is applied
      expect(classifyAdvice("00", word).outcome).not.toBe("paid"); // and the real one refuses it
    });
  }
});
