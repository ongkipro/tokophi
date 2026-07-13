"use server";
import { db, schema } from "@tokophi/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { requireCapability } from "@/lib/rbac";
import { withCurrentTenant, withTenant } from "@/lib/tenant";
import { getCodPolicy } from "@/lib/cod";
import { kaShippingPrice, kaCreateOrder, kaTrack, kaCancelShipment, kiriminajaConfigured } from "@tokophi/lib/kiriminaja";
import { resolveArea } from "@/lib/data/areas";

export type Rate = { service: string; code: string; type: string; cost: number; etd: string; cod: boolean; group: string };

// Live shipping rates from KiriminAja for an order's destination. Resolves the store city
// (origin) + the order's city (destination) to KiriminAja district IDs, then prices.
export async function getShippingRates(input: {
  destinationCity: string;
  weightGrams: number;
  itemValue: number;
}): Promise<{ ok: boolean; rates: Rate[]; origin?: string; destination?: string; codEnabled?: boolean; error?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, rates: [], error: "Sesi tidak valid." };
  if (!kiriminajaConfigured()) return { ok: false, rates: [], error: "KiriminAja belum dikonfigurasi oleh platform (super-admin → Pengaturan)." };

  const storeCity = await withCurrentTenant(async (db) => {
    const [s] = await db.select({ city: schema.stores.city }).from(schema.stores).where(eq(schema.stores.id, session.storeId)).limit(1);
    return s?.city ?? "Yogyakarta";
  });

  const [originOpts, destOpts] = await Promise.all([
    resolveArea(storeCity),
    resolveArea(input.destinationCity || storeCity),
  ]);
  const origin = originOpts[0]?.id;
  const destination = destOpts[0]?.id;
  if (!origin) return { ok: false, rates: [], error: `Area asal "${storeCity}" tidak ditemukan di KiriminAja.` };
  if (!destination) return { ok: false, rates: [], error: `Area tujuan "${input.destinationCity}" tidak ditemukan di KiriminAja.` };

  const r = await kaShippingPrice({ origin, destination, weight: Math.max(1000, input.weightGrams || 0), itemValue: input.itemValue, insurance: 0 });
  if (!r.ok) return { ok: false, rates: [], error: r.error ?? "Gagal mengambil tarif dari KiriminAja." };
  // Same EFFECTIVE COD flag the storefront sees (lib/cod.ts): the merchant's own switch + the
  // platform's per-service allowance. Booking a COD shipment on a service the platform disallowed
  // is exactly the return-cost trap cod_enabled exists to prevent — so it isn't offered here either.
  const cod = await getCodPolicy(session.storeId);
  return {
    ok: true,
    origin: originOpts[0]?.text,
    destination: destOpts[0]?.text,
    codEnabled: cod.enabled,
    rates: r.results.map((x) => ({ service: x.service_name, code: x.service, type: x.service_type, cost: Number(x.cost), etd: x.etd, cod: x.cod && cod.allows(x.service, x.service_type), group: x.group })),
  };
}

// ---- KiriminAja area autocomplete (sender-address picker) ----
export async function searchArea(q: string): Promise<{ id: number; text: string }[]> {
  if (!(await getSession())) return [];
  if (!q.trim()) return [];
  return resolveArea(q.trim());
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

// ---- Enabled couriers offered to shoppers (KiriminAja codes). null = all. ----
export async function getCouriers(): Promise<string[] | null> {
  if (!(await getSession())) return null;
  return withCurrentTenant(async (db) => {
    const [s] = await db.select({ couriers: schema.storeSettings.couriers }).from(schema.storeSettings).limit(1);
    return s?.couriers ?? null;
  });
}

// Courier codes the PLATFORM (super-admin) has enabled — the pool a merchant may pick from.
// platform_couriers is a global table (not tenant-scoped), so it's read on the owner connection.
export async function getPlatformCouriers(): Promise<string[]> {
  if (!(await getSession())) return [];
  const rows = await db
    .select({ courier: schema.platformCouriers.courier, enabled: schema.platformCouriers.enabled })
    .from(schema.platformCouriers);
  return rows.filter((r) => r.enabled).map((r) => r.courier);
}

export async function saveCouriers(couriers: string[]): Promise<{ ok: boolean; error?: string }> {
  const { storeId } = await requireCapability("settings:write");
  await withTenant(storeId, (db) =>
    db
      .insert(schema.storeSettings)
      .values({ storeId, couriers })
      .onConflictDoUpdate({ target: schema.storeSettings.storeId, set: { couriers } }),
  );
  revalidatePath("/pengaturan");
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Jasa Kirim — the merchant picks SERVICES, not couriers.
//
// "JNE" is not a shipping option; "JNE Express Reguler (REG23)" is. The old model stored a list of
// courier CODES, which cannot express "I ship JNE Reguler but not JNE YES" — and the hand-written
// roster it drew from had drifted from KiriminAja anyway (it listed TIKI and Pos, which the API
// does not return). The real roster comes from kaServices(); the platform enables a subset; the
// merchant enables a subset of THAT.
//
// COD is decided in three places on purpose:
//   platform_cod.enabled            — the platform allows COD at all (+ max amount, provinces)
//   platform_couriers.services[].codAllowed — which SERVICES may carry it (super-admin)
//   store_settings.cod_enabled      — this merchant wants it (default off)
// A service offers COD only when all three agree AND KiriminAja itself reports cod=true for it.
// ─────────────────────────────────────────────────────────────────────────────

export type PlatformService = {
  courier: string;
  type: string; // KiriminAja service_type — the booking code
  name: string;
  group: string; // cargo | regular | next_day | economy | one_day
  cod: boolean; // KiriminAja supports COD on this service
  codAllowed: boolean; // …and the platform permits it
};

type StoredService = { type: string; name: string; group: string; cod: boolean; codAllowed?: boolean };

/** Services the PLATFORM has enabled — the pool a merchant may offer. Global table → owner conn. */
export async function getPlatformServices(): Promise<PlatformService[]> {
  if (!(await getSession())) return [];
  const rows = await db
    .select({
      courier: schema.platformCouriers.courier,
      services: schema.platformCouriers.services,
      enabled: schema.platformCouriers.enabled,
    })
    .from(schema.platformCouriers);

  const out: PlatformService[] = [];
  for (const r of rows) {
    if (!r.enabled) continue;
    const list = (r.services as StoredService[] | null) ?? [];
    for (const s of list) {
      // Legacy rows stored plain strings ("REG"). Skip them — they carry no group/cod and the
      // sync will replace them on the next run.
      if (typeof s !== "object" || !s.type) continue;
      out.push({
        courier: r.courier,
        type: s.type,
        name: s.name,
        group: s.group,
        cod: !!s.cod,
        codAllowed: !!s.cod && s.codAllowed !== false,
      });
    }
  }
  return out;
}

/** The services THIS store offers. Empty = none picked yet (the UI then offers to enable all). */
export async function getStoreServices(): Promise<{ courier: string; type: string }[]> {
  if (!(await getSession())) return [];
  return withCurrentTenant(async (db) => {
    const rows = await db
      .select({
        courier: schema.storeShippingMethods.courier,
        service: schema.storeShippingMethods.service,
        enabled: schema.storeShippingMethods.enabled,
      })
      .from(schema.storeShippingMethods);
    return rows.filter((r) => r.enabled).map((r) => ({ courier: r.courier, type: r.service }));
  });
}

export async function saveStoreServices(
  services: { courier: string; type: string }[],
): Promise<{ ok: boolean; error?: string }> {
  const { storeId } = await requireCapability("settings:write");
  await withTenant(storeId, async (db) => {
    // full replace — the UI always sends the complete set
    await db.delete(schema.storeShippingMethods);
    if (services.length) {
      await db.insert(schema.storeShippingMethods).values(
        services.map((s) => ({ storeId, courier: s.courier, service: s.type, enabled: true })),
      );
    }
  });
  revalidatePath("/pengaturan");
  return { ok: true };
}

/** The merchant's COD switch (store_settings.cod_enabled, migration 0038). */
export async function getCodEnabled(): Promise<boolean> {
  if (!(await getSession())) return false;
  return withCurrentTenant(async (db) => {
    const [s] = await db.select({ cod: schema.storeSettings.codEnabled }).from(schema.storeSettings).limit(1);
    return !!s?.cod;
  });
}

export async function setCodEnabled(on: boolean): Promise<{ ok: boolean; error?: string }> {
  const { storeId } = await requireCapability("settings:write");
  await withTenant(storeId, (db) =>
    db
      .insert(schema.storeSettings)
      .values({ storeId, codEnabled: on })
      .onConflictDoUpdate({ target: schema.storeSettings.storeId, set: { codEnabled: on } }),
  );
  revalidatePath("/pengaturan");
  return { ok: true };
}

// ---- Create a KiriminAja shipment for an order → saves AWB / resi on the order ----
export async function createShipment(input: {
  orderNumber: string; service: string; serviceType: string; serviceName: string; cost: number;
  insurance?: boolean; cod?: boolean;
}): Promise<{ ok: boolean; awb?: string; error?: string }> {
  const { storeId } = await requireCapability("orders:write");
  if (!kiriminajaConfigured()) return { ok: false, error: "KiriminAja belum dikonfigurasi oleh platform." };
  // Booking a COD shipment tells the courier to collect cash — same money path as a COD checkout,
  // so the same policy gate (store switch × platform per-service allowance).
  if (input.cod) {
    const reason = (await getCodPolicy(storeId)).reason(input.service, input.serviceType);
    if (reason) return { ok: false, error: reason };
  }

  const data = await withTenant(storeId, async (db) => {
    const [s] = await db.select().from(schema.storeSettings).where(eq(schema.storeSettings.storeId, storeId)).limit(1);
    const [o] = await db
      .select({
        id: schema.orders.id,
        number: schema.orders.number, city: schema.orders.city, awb: schema.orders.awb,
        subtotal: schema.orders.subtotalIdr, total: schema.orders.totalIdr,
        custName: schema.customers.name, custPhone: schema.customers.phone,
      })
      .from(schema.orders)
      .leftJoin(schema.customers, eq(schema.customers.id, schema.orders.customerId))
      .where(eq(schema.orders.number, input.orderNumber))
      .limit(1);
    // real package weight (sum of variant weight × qty) + dimensions (max per axis across items)
    const pkgRows = o
      ? await db
          .select({
            weight: schema.productVariants.weightGrams, qty: schema.orderLineItems.qty,
            l: schema.products.lengthCm, w: schema.products.widthCm, h: schema.products.heightCm,
          })
          .from(schema.orderLineItems)
          .leftJoin(schema.productVariants, eq(schema.productVariants.id, schema.orderLineItems.variantId))
          .leftJoin(schema.products, eq(schema.products.id, schema.productVariants.productId))
          .where(eq(schema.orderLineItems.orderId, o.id))
      : [];
    return { s, o, pkgRows };
  });

  const s = data.s;
  const o = data.o;
  if (!o) return { ok: false, error: "Pesanan tidak ditemukan." };
  if (o.awb) return { ok: false, error: `Pesanan sudah punya resi (${o.awb}).` };
  if (!s?.senderKecamatanId) return { ok: false, error: "Alamat pengirim belum diatur — Pengaturan → Pengiriman." };

  const dest = await resolveArea(o.city ?? "");
  if (!dest[0]) return { ok: false, error: `Area tujuan "${o.city}" tidak ditemukan di KiriminAja.` };

  const now = new Date(Date.now() + 24 * 60 * 60 * 1000); // pickup ~tomorrow
  const pad = (n: number) => String(n).padStart(2, "0");
  const schedule = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} 15:00:00`;
  // real package weight (Σ variant weight × qty, ≥1kg) + dimensions (max per axis across items)
  const pkgRows = data.pkgRows;
  const actualWeight = pkgRows.reduce((a, r) => a + (r.weight ?? 0) * (r.qty ?? 1), 0);
  const weight = Math.max(1000, actualWeight);
  const length = Math.max(0, ...pkgRows.map((r) => r.l ?? 0)) || undefined;
  const width = Math.max(0, ...pkgRows.map((r) => r.w ?? 0)) || undefined;
  const height = Math.max(0, ...pkgRows.map((r) => r.h ?? 0)) || undefined;

  const r = await kaCreateOrder(
    {
      name: s.senderName || "Toko", phone: s.senderPhone || "081200000000", address: s.senderAddress || "-",
      kecamatanId: s.senderKecamatanId, kelurahanId: s.senderKelurahanId, lat: s.senderLat, lng: s.senderLng,
    },
    {
      orderRef: input.orderNumber.replace(/[^A-Za-z0-9]/g, ""),
      destName: o.custName || "Penerima", destPhone: o.custPhone || "081200000000", destAddress: o.city || "-",
      destKecamatanId: dest[0].id,
      weight, width, length, height, itemValue: o.subtotal || o.total || 0, itemName: `Pesanan ${o.number}`,
      service: input.service, serviceType: input.serviceType, shippingCost: input.cost,
      cod: input.cod ? (o.total || o.subtotal || 0) : 0,
      insuranceAmount: input.insurance ? (o.subtotal || o.total || 0) : 0,
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
    db.update(schema.orders)
      .set({ awb: resi, courier: input.serviceName, kaOrderId: r.kaOrderId, status: "dikirim" })
      .where(eq(schema.orders.number, input.orderNumber)),
  );
  revalidatePath(`/pesanan/${input.orderNumber}`);
  return { ok: true, awb: resi };
}

// ---- Cancel / void a shipment (AWB) → clears the shipment from the order ----
export async function cancelShipment(orderNumber: string, reason = "Dibatalkan oleh penjual"): Promise<{ ok: boolean; error?: string }> {
  const { storeId } = await requireCapability("orders:write");
  const awb = await withTenant(storeId, async (db) => {
    const [o] = await db.select({ awb: schema.orders.awb }).from(schema.orders).where(eq(schema.orders.number, orderNumber)).limit(1);
    return o?.awb ?? null;
  });
  if (!awb) return { ok: false, error: "Pesanan ini belum punya pengiriman." };
  const r = await kaCancelShipment(awb, reason);
  if (!r.ok) return { ok: false, error: r.error ?? "Gagal membatalkan pengiriman." };
  await withTenant(storeId, (db) =>
    db.update(schema.orders).set({ awb: null, courier: null, kaOrderId: null }).where(eq(schema.orders.number, orderNumber)),
  );
  revalidatePath(`/pesanan/${orderNumber}`);
  return { ok: true };
}

// ---- Track a shipment (polling) → returns status/history; syncs the real courier AWB when it appears ----
export async function trackShipment(orderNumber: string): Promise<{
  ok: boolean; message: string; awb?: string; history?: { date: string; desc: string }[];
}> {
  const { storeId } = await requireCapability("orders:write");
  const ref = await withTenant(storeId, async (db) => {
    const [o] = await db.select({ kaOrderId: schema.orders.kaOrderId }).from(schema.orders).where(eq(schema.orders.number, orderNumber)).limit(1);
    return o?.kaOrderId ?? null;
  });
  if (!ref) return { ok: false, message: "Pesanan ini belum punya pengiriman." };

  const r = await kaTrack(ref);
  if (!r.ok) {
    const unavailable = /tidak tersedia|not available|belum/i.test(r.error ?? "");
    return { ok: false, message: unavailable ? "Tracking belum tersedia — menunggu paket dijemput/diproses kurir." : (r.error ?? "Tracking belum tersedia.") };
  }

  // shape is courier-dependent; pull an AWB + history best-effort
  const data = (r.data ?? {}) as { awb?: string; waybill?: string; history?: { date?: string; desc?: string; description?: string }[]; manifest?: unknown[] };
  const realAwb = data.awb || data.waybill;
  if (realAwb && realAwb !== ref) {
    await withTenant(storeId, (db) => db.update(schema.orders).set({ awb: realAwb }).where(eq(schema.orders.number, orderNumber)));
    revalidatePath(`/pesanan/${orderNumber}`);
  }
  const history = (data.history ?? []).map((h) => ({ date: h.date ?? "", desc: h.desc ?? h.description ?? "" }));
  return { ok: true, message: realAwb ? `Resi kurir: ${realAwb}` : "Pengiriman terdaftar — menunggu update kurir.", awb: realAwb, history };
}
