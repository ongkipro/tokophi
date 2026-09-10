import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

// 🔴 ONE KIRIMINAJA SUBDISTRICT ID BELONGS TO ONE VILLAGE, AND A CONTESTED ID IS A WRONG ID.
//
// `packages/db/data/kelurahan.csv` carries two ids per row: the Kemendagri code it is keyed on
// (the postcode dataset is published under that key) and `ka_kelurahan_id`, KiriminAja's own,
// filled by `scripts/build-ka-kelurahan-ids.mjs` walking `POST /api/mitra/kelurahan`. The second
// one is the only value `v6.2/request_pickup` accepts, and it reaches `store_settings
// .sender_kelurahan_id` — a real pickup rider is dispatched with it.
//
// The first full walk (2026-09-10, 78 764 rows) matched by NAME, per row, and never marked a
// vendor record taken. Sibling villages whose names differ only by a numeral therefore both
// landed on the same id: "Cimanggu I" / "Cimanggu II" → 8252, "Gunung Bunder I" / "Gunung
// Bunder II" → 8529, "Biwage 1" / "Biwage 2" → 22634. **124 vendor ids claimed twice, 270 of our
// rows involved.** For each pair at most one row can be right and nothing in the file says which,
// so both are wrong in the only sense that matters: unusable without checking.
//
// The matcher now claims a candidate exclusively and abandons a contested one on both sides. This
// file pins the OUTPUT, because the matcher can be rewritten and the CSV is what ships. A blank
// column is the safe state the whole pipeline is built around — `kelurahanOptions` returns null,
// `saveSenderAddress` stores NULL, the booking omits the field. A duplicate is not safe.
const DIR = dirname(fileURLToPath(import.meta.url));
const CSV = join(DIR, "../data/kelurahan.csv");

// `name` is quoted (it can contain a comma); nothing else is. The 5th field may be empty.
const LINE = /^([^,]+),(\d+),"((?:[^"]|"")*)",(\d+)(?:,(\d*))?$/;

type Row = { code: string; districtId: number; name: string; postcode: string; kaId: number | null };

function rows(): Row[] {
  const lines = readFileSync(CSV, "utf8").trim().split("\n");
  expect(lines[0]).toBe("code,ka_district_id,name,postcode,ka_kelurahan_id");
  const out: Row[] = [];
  for (const line of lines.slice(1)) {
    const m = LINE.exec(line);
    // A line the loader cannot parse is silently DROPPED by `seed-areas.ts` too, so an unparseable
    // row is village data that will never reach the database. That is a failure, not a skip.
    expect(m, `unparseable row: ${line.slice(0, 80)}`).not.toBeNull();
    out.push({
      code: m![1],
      districtId: Number(m![2]),
      name: m![3].replaceAll('""', '"'),
      postcode: m![4],
      kaId: m![5] ? Number(m![5]) : null,
    });
  }
  return out;
}

describe("kelurahan.csv", () => {
  const all = rows();

  it("gives one KiriminAja subdistrict id to at most one village per district", () => {
    const seen = new Map<string, Row>();
    const clashes: string[] = [];
    for (const r of all) {
      if (r.kaId === null) continue;
      const key = `${r.districtId}|${r.kaId}`;
      const prev = seen.get(key);
      if (prev) clashes.push(`district ${r.districtId} ka_id ${r.kaId}: "${prev.name}" vs "${r.name}"`);
      else seen.set(key, r);
    }
    expect(clashes.slice(0, 12).join("\n")).toBe("");
    expect(clashes).toHaveLength(0);
  });

  // The same id under two DIFFERENT districts would mean the vendor reuses ids across kecamatan,
  // which would make `sender_kelurahan_id` ambiguous without its district. Measured: it does not.
  it("does not reuse one KiriminAja subdistrict id across districts", () => {
    const owner = new Map<number, number>();
    const crossed: string[] = [];
    for (const r of all) {
      if (r.kaId === null) continue;
      const prev = owner.get(r.kaId);
      if (prev !== undefined && prev !== r.districtId) crossed.push(`ka_id ${r.kaId}: district ${prev} and ${r.districtId}`);
      else owner.set(r.kaId, r.districtId);
    }
    expect(crossed.slice(0, 12).join("\n")).toBe("");
  });

  it("keys every village on a distinct Kemendagri code", () => {
    const codes = new Set(all.map((r) => r.code));
    expect(codes.size).toBe(all.length);
  });

  // A coverage FLOOR, not a target. It exists so that a re-walk which quietly loses most of its
  // matches — the vendor soft-throttles with HTTP 200 and an empty body, which a first run read as
  // "no data" for 59,7% of districts — cannot be committed looking healthy. Measured after the
  // 2026-09-10 walk, after the contested claims were abandoned: 74 017 of 78 764 filled (93,97%).
  // The floor is set well under that so an ordinary vendor-data change does not fail the suite;
  // a collapse does.
  it("keeps most villages matched to a vendor id", () => {
    const filled = all.filter((r) => r.kaId !== null).length;
    expect(all.length).toBeGreaterThan(78_000);
    expect(filled / all.length).toBeGreaterThan(0.85);
  });
});
