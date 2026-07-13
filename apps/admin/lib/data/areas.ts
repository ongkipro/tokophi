import "server-only";
import { db, schema } from "@tokophi/db";
import { or, ilike, eq } from "drizzle-orm";
import { kaAddressByName } from "@tokophi/lib/kiriminaja";

export type Area = { id: number; text: string };

const fmt = (r: { districtName: string; cityType: string | null; cityName: string; provinceName: string }) =>
  `${r.districtName}, ${r.cityType ?? ""} ${r.cityName}, ${r.provinceName}`.replace(/\s+/g, " ").trim();

// Local KiriminAja area search (kecamatan/city name → id) from the imported reference table.
export async function searchAreaLocal(q: string, limit = 8): Promise<Area[]> {
  const term = `%${q.trim()}%`;
  const rows = await db
    .select()
    .from(schema.kiriminajaAreas)
    .where(or(ilike(schema.kiriminajaAreas.districtName, term), ilike(schema.kiriminajaAreas.cityName, term)))
    .limit(limit);
  return rows.map((r) => ({ id: r.id, text: fmt(r) }));
}

// Resolve an area by name — local table first (instant, no rate limit), live API as fallback.
export async function resolveArea(q: string, limit = 8): Promise<Area[]> {
  if (!q.trim()) return [];
  const local = await searchAreaLocal(q, limit);
  if (local.length) return local;
  return kaAddressByName(q);
}

/**
 * The province of a KiriminAja district id — the ONLY province we are willing to trust.
 *
 * The buyer types their province into a free-text field, so `address.provinsi` is a claim, not a
 * fact: a hostile client can send "DKI Jakarta" and have the parcel delivered to Papua, walking
 * straight through platform_cod.allowed_provinces. The district id, by contrast, is the one the
 * ongkir quote was actually issued for and the one the parcel will be booked against — it cannot
 * disagree with where the package goes.
 *
 * Returns null when the id is unknown. Callers gating money (COD) must treat null as "cannot
 * verify" and refuse, never as "probably fine".
 */
export async function provinceForDistrict(districtId: number): Promise<string | null> {
  if (!Number.isFinite(districtId) || districtId <= 0) return null;
  const [row] = await db
    .select({ province: schema.kiriminajaAreas.provinceName })
    .from(schema.kiriminajaAreas)
    .where(eq(schema.kiriminajaAreas.id, districtId))
    .limit(1);
  return row?.province ?? null;
}
