import { and, eq } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import * as schema from "./schema";

/**
 * The ONE place a booking coordinate comes from (Task 8.14, 0109).
 *
 * `v6.2/request_pickup` requires a lat/lng for the sender and for every package. We hold no
 * street-level geocode for anyone, so the honest answer is the centroid of the smallest area the
 * address is known to be in: the kelurahan when one is known, else the district. Both come from
 * the Kemendagri boundaries dataset via the reference CSVs; both may be NULL, and NULL here means
 * the caller OMITS the fields — the sink guard in `@tokophi/lib/kiriminaja` refuses `0,0` anyway.
 *
 * `kaKelurahanId` is KiriminAja's own subdistrict id (never the Kemendagri code) and is only
 * trusted together with the district it was derived against — a subdistrict belongs to exactly one
 * district, so a mismatched pair is a wrong id, and the query returns nothing for it rather than
 * a coordinate in a kecamatan the parcel is not going to.
 */
export type AreaCoords = { lat: number; lng: number; source: "kelurahan" | "district" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

export async function resolveAreaCoords(
  db: AnyDb,
  a: { districtId: number | null | undefined; kaKelurahanId?: number | null },
): Promise<AreaCoords | null> {
  if (!a.districtId) return null;
  if (a.kaKelurahanId) {
    const [k] = await db
      .select({ lat: schema.kelurahan.lat, lng: schema.kelurahan.lng })
      .from(schema.kelurahan)
      .where(and(eq(schema.kelurahan.kaKelurahanId, a.kaKelurahanId), eq(schema.kelurahan.districtId, a.districtId)))
      .limit(1);
    if (k?.lat != null && k?.lng != null) return { lat: k.lat, lng: k.lng, source: "kelurahan" };
  }
  const [d] = await db
    .select({ lat: schema.kiriminajaAreas.lat, lng: schema.kiriminajaAreas.lng })
    .from(schema.kiriminajaAreas)
    .where(eq(schema.kiriminajaAreas.id, a.districtId))
    .limit(1);
  if (d?.lat != null && d?.lng != null) return { lat: d.lat, lng: d.lng, source: "district" };
  return null;
}
