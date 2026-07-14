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

// ---- Create a KiriminAja shipment for an order ----
//
// What KiriminAja actually returns from request_pickup (verified against the sandbox, every
// courier, 2026-07):
//
//   { status: true, pickup_number: "XID-4120916072",
//     details: [{ order_id: "…", kj_order_id: "…", awb: null, service: "JNE", … }] }
//
// The AWB is NULL. It is the COURIER's waybill number, and the courier only allocates it once it
// accepts the pickup — the aggregator cannot invent one either. In production it is usually
// present in this same response; in the sandbox it never is.
//
// So `orders.awb` is written ONLY from `details[0].awb`. The previous code did
// `const resi = r.awb ?? r.kaOrderId` — which stored OUR OWN order_id ("5758-INV4534") in the
// `awb` column and printed it on the shipping label under the heading "No. resi". That is a
// fabricated waybill on a real parcel: no courier can scan it and no customer can track it. The
// booking reference goes in `orders.ka_order_id`, where it belongs, and `awb` stays NULL until a
// courier issues a real one (booking response, or the tracking sync in trackShipment()).
export type CreateShipmentResult = {
  ok: boolean;
  /** The courier waybill — null when KiriminAja has not issued one yet. NEVER back-filled. */
  awb?: string | null;
  /** KiriminAja booking reference (kj_order_id) — real, but NOT a waybill. */
  kaOrderId?: string;
  pickupNumber?: string;
  /** Booked, but no waybill yet → the label cannot be printed. */
  awbPending?: boolean;
  error?: string;
  /** The sender address is unusable → the UI links the merchant to Pengaturan → Alamat. */
  senderIncomplete?: boolean;
  /** Exactly which sender fields are missing. */
  missing?: string[];
};

export async function createShipment(input: {
  orderNumber: string; service: string; serviceType: string; serviceName: string; cost: number;
  insurance?: boolean; cod?: boolean;
}): Promise<CreateShipmentResult> {
  const { storeId } = await requireCapability("orders:write");
  if (!kiriminajaConfigured()) return { ok: false, error: "KiriminAja belum dikonfigurasi oleh platform." };

  const data = await withTenant(storeId, async (db) => {
    const [s] = await db.select().from(schema.storeSettings).where(eq(schema.storeSettings.storeId, storeId)).limit(1);
    const [o] = await db
      .select({
        id: schema.orders.id,
        number: schema.orders.number, city: schema.orders.city, province: schema.orders.province, awb: schema.orders.awb,
        kaOrderId: schema.orders.kaOrderId,
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
  if (o.kaOrderId) return { ok: false, error: `Pesanan sudah dibooking ke kurir (${o.kaOrderId}).` };

  // The sender address is the pickup origin. KiriminAja rejects request_pickup without a
  // kecamatan_id, and the phone/name/address ride on the physical label the driver reads — a
  // blank one means a courier at the wrong door. Fail here, by field, rather than letting the
  // API 400 with a message the merchant cannot act on.
  const missing: string[] = [];
  if (!s?.senderName?.trim()) missing.push("nama pengirim");
  if (!s?.senderPhone?.trim()) missing.push("nomor HP pengirim");
  if (!s?.senderAddress?.trim()) missing.push("alamat lengkap");
  if (!s?.senderKecamatanId) missing.push("kecamatan (wajib — kurir tidak bisa menjemput tanpa ini)");
  if (missing.length || !s?.senderKecamatanId) {
    return {
      ok: false,
      senderIncomplete: true,
      missing,
      error: `Alamat pengirim belum lengkap: ${missing.join(", ")}. Lengkapi di Pengaturan → Alamat sebelum membuat pengiriman.`,
    };
  }

  // Booking a COD shipment tells the courier to collect cash — the same money path as a COD checkout,
  // so it goes through the same gate (lib/cod.ts): platform switch × store switch × the platform's
  // amount cap × the province allow-list × the per-service allowance. Checked here, after the order
  // is loaded, because the cap and the province are properties of the ORDER (a Rp5jt COD parcel to a
  // province we have no return leg for is the risk platform_cod exists to bound — booking it from the
  // admin must not be a way around that).
  if (input.cod) {
    const policy = await getCodPolicy(storeId);
    const reason = policy.reason({
      courier: input.service, serviceType: input.serviceType,
      total: Number(o.total), province: o.province,
    });
    if (reason) return { ok: false, error: reason };
  }

  const dest = await resolveArea(o.city ?? "");
  if (!dest[0]) return { ok: false, error: `Area tujuan "${o.city}" tidak ditemukan di KiriminAja.` };

  // Pickup = TOMORROW 10:00 WIB. The date must be computed in Asia/Jakarta, not in the server's
  // timezone, or a UTC box books the wrong day. 10:00 and not 15:00 because couriers enforce a
  // daily cut-off and reject anything past it — the sandbox rejects J&T outright at 15:00
  // ("telah melewati batas pemrosesan ekspedisi (Pukul 14:53:00 WIB)").
  const jkt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const schedule = `${jkt} 10:00:00`;
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
    const e = (r.error ?? "").toLowerCase();
    // KiriminAja's rejections are actionable — surface WHAT to fix, not just that it failed.
    const hint = e.includes("prefix")
      ? " (daftarkan prefix order_id di KiriminAja Dashboard, atau set KIRIMINAJA_ORDER_PREFIX)"
      : e.includes("latitude") || e.includes("longitude")
        ? " (kurir ini butuh titik koordinat pengirim — isi Latitude/Longitude di Pengaturan → Alamat)"
        : e.includes("batas pemrosesan") || e.includes("penjadwalan")
          ? " (kurir ini sudah melewati jam cut-off — coba layanan lain atau jadwalkan besok)"
          : "";
    return { ok: false, error: (r.error ?? "Gagal membuat pengiriman.") + hint };
  }

  // Only a waybill KiriminAja actually returned lands in `awb`. Nothing is substituted for it.
  const awb = r.awb ?? null;
  await withTenant(storeId, (db) =>
    db.update(schema.orders)
      .set({ awb, courier: input.serviceName, kaOrderId: r.kaOrderId, status: "dikirim" })
      .where(eq(schema.orders.number, input.orderNumber)),
  );
  revalidatePath(`/pesanan/${input.orderNumber}`);
  return { ok: true, awb, kaOrderId: r.kaOrderId, pickupNumber: r.pickupNumber, awbPending: !awb };
}

// ---- Cancel / void a shipment → clears the booking from the order ----
//
// KiriminAja's cancel_shipment is keyed on the AWB. Previously this action read ONLY `orders.awb`
// and bailed with "belum punya pengiriman" when it was null — which, now that `awb` is honestly
// null until a courier issues one, would be every freshly booked shipment. So it falls back to the
// booking reference.
//
// VERIFIED LIMITATION (sandbox, 2026-07): cancel_shipment answers `{"status":false,"text":"Paket
// tidak ditemukan"}` for a booking reference — it really does want a courier AWB, and the sandbox
// never issues one. So in sandbox a booked shipment cannot be cancelled. We surface KiriminAja's
// own message and leave the order untouched, because the booking DOES still exist on their side:
// silently clearing courier/ka_order_id here would desync us from the courier and strand a real
// pickup nobody knows about.
export async function cancelShipment(orderNumber: string, reason = "Dibatalkan oleh penjual"): Promise<{ ok: boolean; error?: string }> {
  const { storeId } = await requireCapability("orders:write");
  const ref = await withTenant(storeId, async (db) => {
    const [o] = await db
      .select({ awb: schema.orders.awb, kaOrderId: schema.orders.kaOrderId })
      .from(schema.orders).where(eq(schema.orders.number, orderNumber)).limit(1);
    return o?.awb ?? o?.kaOrderId ?? null;
  });
  if (!ref) return { ok: false, error: "Pesanan ini belum punya pengiriman." };
  const r = await kaCancelShipment(ref, reason);
  if (!r.ok) return { ok: false, error: `KiriminAja menolak pembatalan: ${r.error ?? "gagal"}. Pengiriman masih terdaftar di kurir.` };
  await withTenant(storeId, (db) =>
    db.update(schema.orders).set({ awb: null, courier: null, kaOrderId: null }).where(eq(schema.orders.number, orderNumber)),
  );
  revalidatePath(`/pesanan/${orderNumber}`);
  return { ok: true };
}

// ---- Track a shipment → the real KiriminAja response; syncs the courier AWB the moment it exists ----
//
// This is also the ONLY path by which `orders.awb` gets filled after a booking that came back
// without one. The tracking payload is courier-dependent, so the AWB and the history are pulled
// best-effort from the shapes KiriminAja is known to use — and if neither is present, we say so
// rather than inventing a status.
export type TrackResult = {
  ok: boolean;
  message: string;
  /** Real courier waybill, once issued. */
  awb?: string | null;
  /** KiriminAja booking reference the tracking was requested with. */
  kaOrderId?: string | null;
  status?: string | null;
  history: { date: string; desc: string }[];
  /** True when KiriminAja answered but has no movement yet (booked, not picked up). */
  pending?: boolean;
};

export async function trackShipment(orderNumber: string): Promise<TrackResult> {
  const { storeId } = await requireCapability("orders:write");
  const row = await withTenant(storeId, async (db) => {
    const [o] = await db
      .select({ kaOrderId: schema.orders.kaOrderId, awb: schema.orders.awb })
      .from(schema.orders).where(eq(schema.orders.number, orderNumber)).limit(1);
    return o ?? null;
  });
  const ref = row?.kaOrderId ?? row?.awb ?? null;
  if (!ref) return { ok: false, message: "Pesanan ini belum punya pengiriman.", history: [] };

  const r = await kaTrack(ref);
  if (!r.ok) {
    const unavailable = /tidak tersedia|not available|belum/i.test(r.error ?? "");
    return {
      ok: false,
      pending: unavailable,
      kaOrderId: ref,
      awb: row?.awb ?? null,
      history: [],
      message: unavailable
        ? "KiriminAja belum punya data lacak untuk pengiriman ini — kurir belum menjemput/memproses paket. Nomor resi terbit setelah paket diproses kurir."
        : (r.error ?? "Tracking belum tersedia."),
    };
  }

  const data = (r.data ?? {}) as {
    awb?: string; waybill?: string; status?: string;
    history?: { date?: string; time?: string; desc?: string; description?: string; status?: string }[];
  };
  // A waybill is only a waybill if it isn't just our own booking reference echoed back.
  const realAwb = [data.awb, data.waybill].find((x) => !!x && x !== ref) ?? null;
  if (realAwb) {
    await withTenant(storeId, (db) =>
      db.update(schema.orders).set({ awb: realAwb }).where(eq(schema.orders.number, orderNumber)),
    );
    revalidatePath(`/pesanan/${orderNumber}`);
  }
  const history = (data.history ?? []).map((h) => ({
    date: [h.date, h.time].filter(Boolean).join(" ").trim(),
    desc: h.desc ?? h.description ?? h.status ?? "",
  }));
  return {
    ok: true,
    awb: realAwb ?? row?.awb ?? null,
    kaOrderId: ref,
    status: data.status ?? null,
    history,
    pending: history.length === 0,
    message: realAwb
      ? `Nomor resi kurir diterima: ${realAwb}`
      : history.length
        ? `Update terakhir: ${history[history.length - 1].desc}`
        : "Pengiriman terdaftar di KiriminAja — belum ada pergerakan dari kurir.",
  };
}
