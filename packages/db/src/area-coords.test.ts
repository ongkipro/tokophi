import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import { resolveAreaCoords } from "./area-coords";

// `resolveAreaCoords` is the ONE producer of a booking coordinate (0109). Real Postgres, because
// the claim that matters is about the JOIN: a kelurahan id is trusted only under the district it
// was derived against, and a missing centroid falls back to the district's, then to nothing.
// Fixture rows live in a transaction that is rolled back, so the reference tables — which the
// deploy's seed-areas.ts owns — are never left with a made-up district.
const DB_URL = process.env.TEST_DATABASE_URL;
const suite = DB_URL ? describe : describe.skip;

suite("resolveAreaCoords", () => {
  let sql: ReturnType<typeof postgres>;
  beforeAll(() => {
    sql = postgres(DB_URL!, { max: 1 });
  });
  afterAll(async () => {
    await sql?.end();
  });

  // One district (id 9_900_001) with a centroid, one village under it with a centroid, one village
  // under it WITHOUT one, and a second district (9_900_002) with no centroid at all.
  async function withFixture<T>(fn: (db: ReturnType<typeof drizzle<typeof schema>>) => Promise<T>): Promise<T> {
    const db = drizzle(sql, { schema, casing: "snake_case" });
    let out!: T;
    await db
      .transaction(async (tx) => {
        await tx.insert(schema.kiriminajaAreas).values([
          { id: 9_900_001, districtName: "Uji Kecamatan", cityName: "Uji", provinceName: "Uji", lat: -7.2797, lng: 112.7595 },
          { id: 9_900_002, districtName: "Uji Tanpa Centroid", cityName: "Uji", provinceName: "Uji" },
        ]);
        await tx.insert(schema.kelurahan).values([
          { id: "99.00.01.1001", districtId: 9_900_001, name: "Uji Kelurahan", postcode: "60281", kaKelurahanId: 9_900_101, lat: -7.2729, lng: 112.7495 },
          { id: "99.00.01.1002", districtId: 9_900_001, name: "Uji Tanpa Titik", postcode: "60282", kaKelurahanId: 9_900_102 },
        ]);
        out = await fn(tx as unknown as ReturnType<typeof drizzle<typeof schema>>);
        throw new Error("rollback");
      })
      .catch((e: Error) => {
        if (e.message !== "rollback") throw e;
      });
    return out;
  }

  it("prefers the kelurahan centroid when the id belongs to the district", async () => {
    const r = await withFixture((db) => resolveAreaCoords(db, { districtId: 9_900_001, kaKelurahanId: 9_900_101 }));
    expect(r).toEqual({ lat: -7.2729, lng: 112.7495, source: "kelurahan" });
  });

  it("falls back to the district centroid when the village has none, or none is given", async () => {
    const [noPoint, noVillage] = await withFixture((db) =>
      Promise.all([
        resolveAreaCoords(db, { districtId: 9_900_001, kaKelurahanId: 9_900_102 }),
        resolveAreaCoords(db, { districtId: 9_900_001 }),
      ]),
    );
    expect(noPoint).toEqual({ lat: -7.2797, lng: 112.7595, source: "district" });
    expect(noVillage).toEqual({ lat: -7.2797, lng: 112.7595, source: "district" });
  });

  // A subdistrict belongs to exactly one district. Pairing a real village id with a district it
  // is not in (the guessed-district case in createShipment) must not yield that village's point —
  // it yields the DISTRICT's, the only one the pair actually supports.
  it("ignores a kelurahan id that is not under the given district", async () => {
    const r = await withFixture((db) => resolveAreaCoords(db, { districtId: 9_900_002, kaKelurahanId: 9_900_101 }));
    expect(r).toBeNull();
  });

  it("returns null — never 0,0 — when nothing is known", async () => {
    const [unknownDistrict, noDistrict] = await withFixture((db) =>
      Promise.all([resolveAreaCoords(db, { districtId: 9_900_002 }), resolveAreaCoords(db, { districtId: null })]),
    );
    expect(unknownDistrict).toBeNull();
    expect(noDistrict).toBeNull();
  });
});
