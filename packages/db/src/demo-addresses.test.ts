// The backfill writes straight into `orders`, and the API that would normally have rejected bad data
// (`/api/public/order`) is not in the path. So the generator is held to the SAME rules the checkout
// boundary enforces: if it can emit a name, phone or address that `@tokophi/lib/validate` refuses,
// the demo store is carrying rows a real checkout could never have produced — which is exactly the
// state this backfill exists to end.
//
// No database here on purpose: everything asserted below is pure.
import { describe, it, expect } from "vitest";
import { addressError, nameError, normalizePhone, postcodeError } from "@tokophi/lib/validate";
import {
  DESTINATIONS, PHONE_PREFIXES, RECIPIENTS,
  buildAddress, buildPhone, hash32, interleaved, mulberry32, recipientFor,
} from "./demo-addresses";

const VILLAGES = ["Rejosari", "Batu Meja", "Sidomulyo", "Karang Tengah", "Ampenan Utara"];

describe("demo-addresses — the backfill generator obeys the checkout's own rules", () => {
  it("every recipient passes nameError, including the shapes that were once wrongly rejected", () => {
    for (const n of RECIPIENTS) expect([n, nameError(n)]).toEqual([n, null]);
    // Pinned by value: these are the exact shapes the 2026-07-17 sweep found being refused. Losing
    // one from the pool would silently remove the only rows that prove the rule is still generous.
    for (const n of ["Nur'aini", "M. Rizky", "I Gusti Ngurah Rai", "Abdul Ghofur Al-Rasyid", "Anne-Marie Tobing"])
      expect(RECIPIENTS).toContain(n);
    // …and they sit at the FRONT, because assignment is `index % length`: move them back and a store
    // with few customers stops containing them at all.
    expect(RECIPIENTS.slice(0, 5)).toEqual(
      ["Nur'aini", "M. Rizky", "I Gusti Ngurah Rai", "Abdul Ghofur Al-Rasyid", "Anne-Marie Tobing"],
    );
  });

  it("every phone is already canonical 62… and survives normalizePhone unchanged", () => {
    for (let i = 0; i < 200; i++) {
      const p = buildPhone(i);
      expect(normalizePhone(p)).toBe(p);
    }
  });

  it("a customer's phone is stable — one buyer, one number, however many parcels", () => {
    expect(buildPhone(3)).toBe(buildPhone(3));
    expect(buildPhone(3)).not.toBe(buildPhone(4));
  });

  it("carries the carrier prefixes a hard-coded operator list would have refused", () => {
    // 0838 / 0881 / 0895 / 0851 — first in the pool, so the lowest customer indices get them.
    expect(PHONE_PREFIXES.slice(0, 4)).toEqual(["838", "881", "895", "851"]);
    const emitted = new Set(Array.from({ length: 4 }, (_, i) => buildPhone(i).slice(2, 5)));
    expect(emitted).toEqual(new Set(["838", "881", "895", "851"]));
  });

  it("every address passes addressError, is ≥15 chars and carries a digit", () => {
    // 15 chars and "has a digit" are the two halves of the repair predicate in the script's SQL — an
    // address that failed either would be re-selected on the next run and idempotence would be false.
    for (let seed = 0; seed < 500; seed++) {
      const a = buildAddress(mulberry32(seed), VILLAGES[seed % VILLAGES.length]);
      expect([a, addressError(a)]).toEqual([a, null]);
      expect(a.length).toBeGreaterThanOrEqual(15);
      expect(a).toMatch(/[0-9]/);
    }
  });

  it("is deterministic — the same order number always gets the same address", () => {
    const once = buildAddress(mulberry32(hash32("PHI-5201")), "Rejosari");
    const twice = buildAddress(mulberry32(hash32("PHI-5201")), "Rejosari");
    expect(twice).toBe(once);
    expect(buildAddress(mulberry32(hash32("PHI-5202")), "Rejosari")).not.toBe(once);
  });

  it("the destination pool has no duplicate ids and covers all four COD buckets", () => {
    expect(new Set(DESTINATIONS.map((d) => d.id)).size).toBe(DESTINATIONS.length);
    for (const b of ["cod-spx", "cod-nospx", "far-spx", "far-nospx"])
      expect(DESTINATIONS.filter((d) => d.bucket === b).length).toBeGreaterThan(0);
    // All six COD-allowed provinces must be reachable, or the COD chain has untestable gaps.
    const cod = new Set(DESTINATIONS.filter((d) => d.bucket.startsWith("cod")).map((d) => d.label.split(", ").pop()));
    expect(cod).toEqual(new Set(["DI Yogyakarta", "Jawa Tengah", "Jawa Barat", "DKI Jakarta", "Banten", "Jawa Timur"]));
  });

  it("interleaving puts all four buckets inside the first few slots", () => {
    const pool = interleaved();
    expect(pool.length).toBe(DESTINATIONS.length);
    expect(new Set(pool.map((d) => d.id)).size).toBe(DESTINATIONS.length);
    // Rows are assigned `pool[i % pool.length]`, and the SPX partition is smaller than the pool — a
    // plain concatenation would have handed every SPX order a `cod-spx` destination.
    expect(new Set(pool.slice(0, 20).map((d) => d.bucket)).size).toBe(4);
  });

  it("recipientFor is stable per customer index", () => {
    expect(recipientFor(0)).toBe(recipientFor(RECIPIENTS.length));
  });

  it("a five-digit postcode is what the script writes", () => {
    // The postcodes themselves come from `kelurahan`; this pins the shape the column must hold.
    expect(postcodeError("55281")).toBeNull();
  });
});
