"use server";
import { schema } from "@tokophi/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { requireCapability } from "@/lib/rbac";
import { withCurrentTenant, withTenant } from "@/lib/tenant";
import { kaAddressByName, kaShippingPrice, kaCreateOrder, kiriminajaConfigured } from "@/lib/kiriminaja";

export type Rate = { service: string; code: string; type: string; cost: number; etd: string; cod: boolean; group: string };

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
    rates: r.results.map((x) => ({ service: x.service_name, code: x.service, type: x.service_type, cost: Number(x.cost), etd: x.etd, cod: x.cod, group: x.group })),
  };
}

// ---- KiriminAja area autocomplete (sender-address picker) ----
export async function searchArea(q: string): Promise<{ id: number; text: string }[]> {
  if (!(await getSession())) return [];
  if (!q.trim()) return [];
  return kaAddressByName(q.trim());
}

export type SenderAddress = {
  name: string; phone: string; address: string;
  kecamatanId: number | null; kecamatanName: string;
  kelurahanId: number | null; kelurahanName: string;
  lat: string; lng: string;
};

export async function getSenderAddress(): Promise<SenderAddress | null> {
  if (!(await getSession())) return null;
  return withCurrentTenant(async (db) => {
    const [s] = await db.select().from(schema.storeSettings).limit(1);
    if (!s) return null;
    return {
      name: s.senderName ?? "", phone: s.senderPhone ?? "", address: s.senderAddress ?? "",
      kecamatanId: s.senderKecamatanId ?? null, kecamatanName: s.senderKecamatanName ?? "",
      kelurahanId: s.senderKelurahanId ?? null, kelurahanName: s.senderKelurahanName ?? "",
      lat: s.senderLat ?? "", lng: s.senderLng ?? "",
    };
  });
}

export async function saveSenderAddress(input: {
  name: string; phone: string; address: string;
  kecamatanId: number | null; kecamatanName: string;
  kelurahanId?: number | null; kelurahanName?: string; lat?: string; lng?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { storeId } = await requireCapability("settings:write");
  const values = {
    senderName: input.name, senderPhone: input.phone, senderAddress: input.address,
    senderKecamatanId: input.kecamatanId, senderKecamatanName: input.kecamatanName,
    senderKelurahanId: input.kelurahanId ?? null, senderKelurahanName: input.kelurahanName ?? "",
    senderLat: input.lat ?? "", senderLng: input.lng ?? "",
  };
  await withTenant(storeId, (db) =>
    db.insert(schema.storeSettings).values({ storeId, ...values }).onConflictDoUpdate({ target: schema.storeSettings.storeId, set: values }),
  );
  revalidatePath("/pengaturan");
  return { ok: true };
}

// ---- Create a KiriminAja shipment for an order → saves AWB / resi on the order ----
export async function createShipment(input: {
  orderNumber: string; service: string; serviceType: string; serviceName: string; cost: number;
}): Promise<{ ok: boolean; awb?: string; error?: string }> {
  const { storeId } = await requireCapability("orders:write");
  if (!kiriminajaConfigured()) return { ok: false, error: "KiriminAja belum dikonfigurasi oleh platform." };

  const data = await withTenant(storeId, async (db) => {
    const [s] = await db.select().from(schema.storeSettings).where(eq(schema.storeSettings.storeId, storeId)).limit(1);
    const [o] = await db
      .select({
        number: schema.orders.number, city: schema.orders.city, awb: schema.orders.awb,
        subtotal: schema.orders.subtotalIdr, total: schema.orders.totalIdr,
        custName: schema.customers.name, custPhone: schema.customers.phone,
        items: schema.orderLineItems.id,
      })
      .from(schema.orders)
      .leftJoin(schema.customers, eq(schema.customers.id, schema.orders.customerId))
      .leftJoin(schema.orderLineItems, eq(schema.orderLineItems.orderId, schema.orders.id))
      .where(eq(schema.orders.number, input.orderNumber))
      .limit(1);
    return { s, o };
  });

  const s = data.s;
  const o = data.o;
  if (!o) return { ok: false, error: "Pesanan tidak ditemukan." };
  if (o.awb) return { ok: false, error: `Pesanan sudah punya resi (${o.awb}).` };
  if (!s?.senderKecamatanId) return { ok: false, error: "Alamat pengirim belum diatur — Pengaturan → Pengiriman." };

  const dest = await kaAddressByName(o.city ?? "");
  if (!dest[0]) return { ok: false, error: `Area tujuan "${o.city}" tidak ditemukan di KiriminAja.` };

  const now = new Date(Date.now() + 24 * 60 * 60 * 1000); // pickup ~tomorrow
  const pad = (n: number) => String(n).padStart(2, "0");
  const schedule = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} 15:00:00`;
  const weight = Math.max(1000, 1000); // ≥1kg (line qty unknown here; default 1kg)

  const r = await kaCreateOrder(
    {
      name: s.senderName || "Toko", phone: s.senderPhone || "081200000000", address: s.senderAddress || "-",
      kecamatanId: s.senderKecamatanId, kelurahanId: s.senderKelurahanId, lat: s.senderLat, lng: s.senderLng,
    },
    {
      orderRef: input.orderNumber.replace(/[^A-Za-z0-9]/g, ""),
      destName: o.custName || "Penerima", destPhone: o.custPhone || "081200000000", destAddress: o.city || "-",
      destKecamatanId: dest[0].id,
      weight, itemValue: o.subtotal || o.total || 0, itemName: `Pesanan ${o.number}`,
      service: input.service, serviceType: input.serviceType, shippingCost: input.cost, cod: 0,
    },
    schedule,
  );
  if (!r.ok) {
    const hint = r.error?.toLowerCase().includes("prefix")
      ? " (daftarkan prefix order_id di KiriminAja Sandbox Dashboard, atau set KIRIMINAJA_ORDER_PREFIX)"
      : "";
    return { ok: false, error: (r.error ?? "Gagal membuat pengiriman.") + hint };
  }
  const resi = r.awb ?? r.kaOrderId;
  await withTenant(storeId, (db) =>
    db.update(schema.orders).set({ awb: resi, courier: input.serviceName, kaOrderId: r.kaOrderId }).where(eq(schema.orders.number, input.orderNumber)),
  );
  revalidatePath(`/pesanan/${input.orderNumber}`);
  return { ok: true, awb: resi };
}
