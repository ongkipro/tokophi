import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertKaKelurahanId, KA_KELURAHAN_ID_MAX } from "./kiriminaja";
import type { KaPackage, KaSender } from "./kiriminaja";
import { codeOnly } from "../../../test/source-code";

// 🔴 TWO ID SPACES, ONE FIELD (Task 8.17).
//
// A village on our side has TWO ids and only one of them is a courier id:
//   Kemendagri   "34.02.07.2001"   `kelurahan.id` — text, dotted, 13 characters. The key the
//                                  POSTCODE dataset is published under. NOT a courier id.
//   KiriminAja   31483             `kelurahan.ka_kelurahan_id` — from POST /api/mitra/kelurahan.
//                                  The only value `v6.2/request_pickup` will accept.
//
// TypeScript refuses the obvious mistake (`kelurahan.id` is a `string`, the field is a `number`).
// It does NOT refuse the dangerous one: a `Number(...)`/`parseInt` upstream turns "34.02.07.2001"
// into a number that type-checks, and the vendor would take it — a pickup routed to a subdistrict
// nobody chose, no error anywhere, discovered when a parcel does not arrive.
//
// So the boundary is a runtime guard at the SINK, and this file pins it from both ends: the guard's
// own behaviour, and the claim that `kiriminaja.ts` builds these two fields ONLY through it.

const sender: KaSender = {
  name: "Toko", phone: "6281234567890", address: "Jl. Malioboro No. 123", kecamatanId: 6138,
};
const pkg: KaPackage = {
  orderRef: "N29", destName: "Penerima", destPhone: "6281298765432", destAddress: "Jl. Mampang No. 10",
  destKecamatanId: 2107, weight: 1000, itemValue: 100000, itemName: "Kain",
  service: "jne", serviceType: "REG23", shippingCost: 17000, items: [],
};
const BOOKED = { status: true, pickup_number: "EPR-1", details: [{ order_id: "x", kj_order_id: "x", awb: "", service: "jne", service_type: "REG23" }] };

async function book(over: { sender?: Partial<KaSender>; pkg?: Partial<KaPackage> } = {}) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(BOOKED), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  const { kaCreateOrder } = await import("./kiriminaja");
  const res = await kaCreateOrder({ ...sender, ...over.sender }, { ...pkg, ...over.pkg }, "2026-09-11 10:00:00");
  const call = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
  return { res, sent: JSON.parse(call[1].body) };
}

afterEach(() => vi.unstubAllGlobals());

// The real shapes, measured — not invented. Left: what `POST /api/mitra/kelurahan` returned live
// for district 548 (Pleret, Bantul) on 2026-09-10. Right: what `kelurahan.id` holds for the same
// villages, straight out of `packages/db/data/kelurahan.csv`.
const REAL_KA_IDS = [31483, 31484, 31485, 31486, 31487, 11481, 32679];
const REAL_KEMENDAGRI_CODES = ["34.02.07.2001", "11.01.01.2001", "74.02.28.1013", "34.02.07.1004"];

describe("assertKaKelurahanId — the sink guard", () => {
  it("accepts the ids KiriminAja actually returns", () => {
    for (const id of REAL_KA_IDS) {
      expect(assertKaKelurahanId(id, "kelurahan_id")).toBe(id);
      expect(assertKaKelurahanId(id, "destination_kelurahan_id")).toBe(id);
    }
  });

  // The shape that would arrive if someone read `kelurahan.id` straight out of the table.
  it("REFUSES a Kemendagri code as a string, and says which id it wanted", () => {
    for (const code of REAL_KEMENDAGRI_CODES) {
      expect(() => assertKaKelurahanId(code, "kelurahan_id")).toThrow(/Kemendagri/);
      expect(() => assertKaKelurahanId(code, "destination_kelurahan_id")).toThrow(/Kemendagri/);
    }
  });

  // The shape TypeScript cannot see: the dots stripped by a `Number()` or a `replace(/\D/g,"")`
  // somewhere upstream. It is a `number`, it is positive, it is an integer — and it is wrong.
  it("REFUSES a Kemendagri code that has been turned into a number", () => {
    for (const code of REAL_KEMENDAGRI_CODES) {
      const asNumber = Number(code.replaceAll(".", ""));
      expect(Number.isSafeInteger(asNumber), "the mistake has to be a plausible integer or this test proves nothing").toBe(true);
      expect(asNumber).toBeGreaterThan(KA_KELURAHAN_ID_MAX);
      expect(() => assertKaKelurahanId(asNumber, "destination_kelurahan_id")).toThrow(/too large/);
    }
    // `Number("34.02.07.2001")` is NaN — a different arm, and it must not slip through as "falsy".
    expect(() => assertKaKelurahanId(Number("34.02.07.2001"), "kelurahan_id")).toThrow();
  });

  it("REFUSES 0, negatives and fractions — none of them is a subdistrict", () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => assertKaKelurahanId(bad, "kelurahan_id"), `${bad} must not pass`).toThrow();
    }
  });

  // The refusal is a THROW, not a silent drop, deliberately: a booking built from a wrong id must
  // fail loudly rather than quietly ship a parcel with one field missing and one field wrong.
  it("a Kemendagri code reaches no payload — the booking throws instead", async () => {
    // 3402072001 = "34.02.07.2001" with its dots gone. A number, an integer, and wrong.
    await expect(book({ pkg: { destKelurahanId: 3402072001 } })).rejects.toThrow(/too large/);
  });
});

describe("the two fields stay CONDITIONAL — NULL means omit", () => {
  it("omits both when we have no KiriminAja id", async () => {
    const { sent } = await book({ sender: { kelurahanId: null }, pkg: { destKelurahanId: null } });
    expect(sent).not.toHaveProperty("kelurahan_id");
    expect(sent.packages[0]).not.toHaveProperty("destination_kelurahan_id");
    // Never `null`, never `0`, never `""` — each of those is a VALUE to the vendor.
    expect(JSON.stringify(sent)).not.toContain("kelurahan_id");
  });

  it("omits them for `undefined` too, which is what a caller that has no column sends", async () => {
    const { sent } = await book({ sender: { kelurahanId: undefined }, pkg: { destKelurahanId: undefined } });
    expect(sent).not.toHaveProperty("kelurahan_id");
    expect(sent.packages[0]).not.toHaveProperty("destination_kelurahan_id");
  });

  it("sends a real id on both halves when one is known", async () => {
    const { sent } = await book({ sender: { kelurahanId: 31483 }, pkg: { destKelurahanId: 32679 } });
    expect(sent.kelurahan_id).toBe(31483);
    expect(sent.packages[0].destination_kelurahan_id).toBe(32679);
  });
});

// ── The source claim ────────────────────────────────────────────────────────────────────────────
// A guard is only a boundary while every path goes through it. The behavioural tests above stay
// green if someone adds a SECOND, unguarded `destination_kelurahan_id:` somewhere in the payload —
// so this reads the file's CODE (comments gone, string contents inert; `codeOnly`, never the text,
// because this file's comments are full of the very field names being hunted).
const KIRIMINAJA_SRC = fileURLToPath(new URL("./kiriminaja.ts", import.meta.url));
// `kelurahan_id:` as an object key — the shape a hand-written field would take. Whitespace-tolerant
// because the scanner joins tokens with single spaces.
const RAW_FIELD = /(?:destination_)?kelurahan_id\s*\]?\s*:/g;

describe("nothing writes these fields except the guard", () => {
  it("`kiriminaja.ts` assigns kelurahan_id nowhere but inside kelurahanField()", () => {
    const code = codeOnly(readFileSync(KIRIMINAJA_SRC, "utf8"));
    const hits = code.match(RAW_FIELD) ?? [];
    // ZERO. The one place these fields are written is `{ [field]: assertKaKelurahanId(...) }`, a
    // COMPUTED key, which carries no literal `kelurahan_id:`. The names still appear in the file as
    // string literals (the helper's parameter type, the two call sites) — a literal is not an
    // assignment, and `"kelurahan_id"` is followed by a quote, never a colon. Any hit here is a
    // hand-written field that skipped the guard.
    expect(hits, `unexpected raw *_kelurahan_id assignments: ${hits.join(", ")}`).toHaveLength(0);
    // Both call sites go through the helper, and the helper goes through the assert.
    expect(code).toMatch(/kelurahanField\s*\(\s*"kelurahan_id"/);
    expect(code).toMatch(/kelurahanField\s*\(\s*"destination_kelurahan_id"/);
    expect(code).toMatch(/assertKaKelurahanId\s*\(\s*value\s*,\s*field\s*\)/);
  });

  // ⚠️ MUTATION SELF-CHECK. A predicate that matches nothing is green for the wrong reason — this
  // repo has shipped that mistake nine times. Prove the claim fires against the code it forbids,
  // on a COPY in memory, never on the file another stream may own.
  it("that claim goes RED against a hand-written field put back", () => {
    const mutated = codeOnly(
      readFileSync(KIRIMINAJA_SRC, "utf8").replace(
        '...kelurahanField("destination_kelurahan_id", pkg.destKelurahanId),',
        "...(pkg.destKelurahanId ? { destination_kelurahan_id: pkg.destKelurahanId } : {}),",
      ),
    );
    expect(mutated.match(RAW_FIELD) ?? [], "the mutation must reintroduce a raw assignment").toHaveLength(1);
  });

  // The other half of the boundary: the SELLER's option list may not carry the Kemendagri primary
  // key at all. A form that can see it is a form that can send it.
  it("`kelurahanWithKaIdForDistrict` selects the vendor id and NOT `kelurahan.id`", () => {
    const src = fileURLToPath(new URL("../../../apps/admin/lib/data/areas.ts", import.meta.url));
    const code = codeOnly(readFileSync(src, "utf8"));
    const fn = code.slice(code.indexOf("kelurahanWithKaIdForDistrict"));
    expect(fn).toMatch(/kaKelurahanId\s*:\s*schema\s*\.\s*kelurahan\s*\.\s*kaKelurahanId/);
    expect(fn, "the Kemendagri primary key must not be selected into the seller's option list").not.toMatch(
      /schema\s*\.\s*kelurahan\s*\.\s*id\b/,
    );
  });
});
