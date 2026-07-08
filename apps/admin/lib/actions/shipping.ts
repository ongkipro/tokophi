"use server";
import { schema } from "@tokophi/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { withCurrentTenant } from "@/lib/tenant";
import { kaAddressByName, kaShippingPrice, kiriminajaConfigured } from "@/lib/kiriminaja";

export type Rate = { service: string; type: string; cost: number; etd: string; cod: boolean; group: string };

// Live shipping rates from KiriminAja for an order's destination. Resolves the store city
// (origin) + the order's city (destination) to KiriminAja district IDs, then prices.
export async function getShippingRates(input: {
  destinationCity: string;
  weightGrams: number;
  itemValue: number;
}): Promise<{ ok: boolean; rates: Rate[]; origin?: string; destination?: string; error?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, rates: [], error: "Sesi tidak valid." };
  if (!kiriminajaConfigured()) return { ok: false, rates: [], error: "KiriminAja belum dikonfigurasi oleh platform (super-admin → Pengaturan)." };

  const storeCity = await withCurrentTenant(async (db) => {
    const [s] = await db.select({ city: schema.stores.city }).from(schema.stores).where(eq(schema.stores.id, session.storeId)).limit(1);
    return s?.city ?? "Yogyakarta";
  });

  const [originOpts, destOpts] = await Promise.all([
    kaAddressByName(storeCity),
    kaAddressByName(input.destinationCity || storeCity),
  ]);
  const origin = originOpts[0]?.id;
  const destination = destOpts[0]?.id;
  if (!origin) return { ok: false, rates: [], error: `Area asal "${storeCity}" tidak ditemukan di KiriminAja.` };
  if (!destination) return { ok: false, rates: [], error: `Area tujuan "${input.destinationCity}" tidak ditemukan di KiriminAja.` };

  const r = await kaShippingPrice({ origin, destination, weight: Math.max(1000, input.weightGrams || 0), itemValue: input.itemValue, insurance: 0 });
  if (!r.ok) return { ok: false, rates: [], error: r.error ?? "Gagal mengambil tarif dari KiriminAja." };
  return {
    ok: true,
    origin: originOpts[0]?.text,
    destination: destOpts[0]?.text,
    rates: r.results.map((x) => ({ service: x.service_name, type: x.service_type, cost: Number(x.cost), etd: x.etd, cod: x.cod, group: x.group })),
  };
}
