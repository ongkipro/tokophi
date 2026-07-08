import "server-only";
import { db, schema } from "@tokophi/db";
import { or, ilike } from "drizzle-orm";
import { kaAddressByName } from "@/lib/kiriminaja";

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
