"use server";
import { db, schema, resolveAreaCoords } from "@tokophi/db";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { normalizePhone } from "@tokophi/lib/validate";
import { requireCapability } from "@/lib/rbac";
import { withCurrentTenant, withTenant, type Tx } from "@/lib/tenant";
import { getCodPolicy } from "@/lib/cod";
import { SHIPPING_SERVICE } from "@tokophi/lib/provider-label";
import { kaShippingPrice, kaCreateOrder, kaTrack, kaCancelShipment, kaCodFee, buildKaOrderRef, kiriminajaConfigured, type KaCodFee } from "@tokophi/lib/kiriminaja";
import { isInstantCourier, isInstantService } from "@tokophi/lib/couriers";
import { resolveArea, provinceForDistrict, kelurahanForDistrict, kelurahanWithKaIdForDistrict } from "@/lib/data/areas";
import { composePickupAddress } from "@/lib/pickup-address";
import { stackedDims } from "@/lib/shipping-weight";
import { applyOrderStatusChange, type OrderStatus } from "@/lib/order-status";
import { outcomeFromTrackingCode, syncOrderFromKa } from "@/lib/ka-tracking";
import { realWaybill } from "@tokophi/lib/kiriminaja-tracking";
import { activeKaEnv } from "@tokophi/lib/provider-config";

// `codFee` = what the aggregator charges for collecting cash on this service (N31). It is deducted
// from the merchant's COD payout, so wherever a merchant sees a COD-capable rate they see this too.
// All-null when the vendor sent no fee config — render nothing, never Rp0.
export type Rate = {
  service: string;
  code: string;
  type: string;
  cost: number;
  etd: string;
  cod: boolean;
  group: string;
  codFee: KaCodFee;
  /** KiriminAja's insurance fee for this quote, IDR — what the booking sends as `insurance_amount`. */
  insurance: number;
  /** The service insures every parcel; the booking carries `insurance_amount` even when unasked. */
  forceInsurance: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// ONE definition of "this order's status is no longer a shipment's to move".
//
// Both shipment actions below used to write `orders.status` with a RAW `db.update`, making them the
// 2nd and 3rd writers of a column the state machine owns — and each carried its OWN hand-copied
// terminal check, in four places, that had to be kept in sync with `applyOrderStatusChange` by hand.
// The status WRITE now goes through `applyOrderStatusChange` (see the call sites); this predicate is
// the part that genuinely cannot.
//
// ⚠️ THIS IS NOT THE SAME SET AS THE STATE MACHINE'S TERMINAL GUARD, AND MUST NOT BE FOLDED INTO IT.
// `applyOrderStatusChange` treats only `batal`/`retur` as terminal, on purpose: `selesai → retur` has
// to stay legal (a delivered parcel refused/returned afterwards — that transition is what fires the
// ledger claw-back, and ledger-credit.test.ts asserts it). A SHIPMENT operation must refuse `selesai`
// on top of that: booking or voiding a courier label is not a reason to un-complete a delivered sale
// whose COD cash is already collected and whose ledger credit is already `available`.
// Widening the machine's guard to include `selesai` would silently kill the return path; narrowing
// this one to match the machine would re-open the un-completion hole. The difference is deliberate —
// so it lives in ONE helper with this note, not copied into four `if`s.
const shipmentLocked = (status: string | null | undefined): boolean => status === "selesai" || status === "batal" || status === "retur";

// ─────────────────────────────────────────────────────────────────────────────
// The SAME two-level filter the storefront applies (/api/public/ongkir): the platform (super-admin)
// sets the hard-enabled courier pool, the merchant picks the services inside it. The seller's own
// order screen used to apply NEITHER — it listed every rate KiriminAja returned, so a courier the
// platform had switched OFF (idx, jtcargo) and services the seller had switched OFF in Jasa Kirim
// were both bookable from the order page. A platform switch that the platform's own admin surface
// ignores is not a control; it is decoration.
//
// `services === null` means the merchant has never opened Jasa Kirim → fall back to the platform
// pool (same rule as the storefront) rather than showing zero options.
// ─────────────────────────────────────────────────────────────────────────────
async function shippingScope(storeId: string): Promise<{ platformOn: string[]; services: Set<string> | null }> {
  const platformRows = await db
    .select({
      courier: schema.platformCouriers.courier,
      enabled: schema.platformCouriers.enabled,
    })
    .from(schema.platformCouriers);
  const platformOn = platformRows.filter((p) => p.enabled && !isInstantCourier(p.courier)).map((p) => p.courier);

  const picked = await withTenant(storeId, (db) =>
    db
      .select({
        courier: schema.storeShippingMethods.courier,
        service: schema.storeShippingMethods.service,
      })
      .from(schema.storeShippingMethods)
      .where(eq(schema.storeShippingMethods.enabled, true)),
  );
  const services = picked.length ? new Set(picked.map((s) => `${s.courier}:${s.service}`)) : null;
  return { platformOn, services };
}

const inScope = (scope: { platformOn: string[]; services: Set<string> | null }, courier: string, type: string) => (!scope.platformOn.length || scope.platformOn.includes(courier)) && (!scope.services || scope.services.has(`${courier}:${type}`));

/** Package rows for an order: real variant weights + product dimensions. ONE definition, so the
 *  price the seller is quoted and the parcel that is booked are built from the same numbers. */
async function packageRows(db: Tx, orderId: string) {
  return db
    .select({
      weight: schema.productVariants.weightGrams,
      qty: schema.orderLineItems.qty,
      l: schema.products.lengthCm,
      w: schema.products.widthCm,
      h: schema.products.heightCm,
      // For the booking's `packages[].items` manifest (Task 8.14). `getShippingRates` ignores both;
      // they cost nothing here and keep ONE definition of "the rows this parcel is made of", so the
      // quote and the booking cannot describe different contents (the N30 lesson, one level down).
      title: schema.orderLineItems.title,
      unitPrice: schema.orderLineItems.priceIdr,
      // v6.2 `items[].metadata` (sku, variant_label) — the same row, so the manifest cannot name a
      // variant the parcel does not contain.
      sku: schema.productVariants.sku,
      variantTitle: schema.productVariants.title,
    })
    .from(schema.orderLineItems)
    .leftJoin(schema.productVariants, eq(schema.productVariants.id, schema.orderLineItems.variantId))
    .leftJoin(schema.products, eq(schema.products.id, schema.productVariants.productId))
    .where(eq(schema.orderLineItems.orderId, orderId));
}

/**
 * The postal code of a district when — and only when — our kelurahan snapshot leaves no doubt
 * (Task 8.14). A kodepos belongs to a kelurahan, not to a kecamatan, but 82% of KiriminAja's
 * districts have exactly ONE across every kelurahan in them; for those the district determines the
 * answer and there is nothing to guess. This is the same derivation the storefront checkout already
 * makes for the shopper (`checkout.astro`), used here for the two spec-required zipcodes when the
 * stored one is missing: a pre-2026-08-03 order (kodepos was not required then) or a seller whose
 * pickup district has no kelurahan data (~4%).
 *
 * More than one postcode ⇒ `null`, never the first row. A wrong postal code goes on a real parcel.
 */
async function soleDistrictPostcode(districtId: number | null | undefined): Promise<string | null> {
  if (!districtId) return null;
  const codes = new Set((await kelurahanForDistrict(districtId)).map((k) => k.postcode));
  return codes.size === 1 ? [...codes][0] : null;
}

// Live shipping rates from KiriminAja for an order's destination.
//
// ⚠️ DESTINATION: pass `orderNumber`. The order carries `ship_district_id` — the KiriminAja district
// the shopper actually picked at checkout and the id the ongkir they paid was quoted against. The
// old path resolved a CITY NAME instead (`resolveArea(order.city)[0]`), and that is not a rounding
// error: `resolveArea("Surabaya")[0]` returns **id 3175 — "Bandar Surabaya, Lampung Tengah,
// LAMPUNG"**, because the district table ilike-matches "%Surabaya%" and Lampung's districts sort
// first. So an order to Surabaya was priced, and booked, to Lampung. Verified against the seeded DB
// (2026-07-14). A district id cannot be ambiguous; a city name always can.
//
// Weight and value are read from the ORDER, so the price the seller is quoted is the price the
// booking is actually made with (createShipment computes the same numbers from the same rows).
//
// ⚠️ The caller passes ONLY the order number. It used to also pass `weightGrams`, which the order
// screen computed as `(totalQty || 2) * 500` in the browser — the same fabricated 500 g/item the
// storefront used. A weight is a PRICE INPUT: if the client states it, the client sets the price,
// and the merchant eats the difference with the courier. Same lesson as the ongkir origin (now the
// seller's pickup district) and the COD province (now the KiriminAja district id): a claim from
// the client is not a fact. There is no fallback parameter to fall back TO — that is the point.
export async function getShippingRates(input: { orderNumber: string }): Promise<{
  ok: boolean;
  rates: Rate[];
  origin?: string;
  destination?: string;
  codEnabled?: boolean;
  error?: string;
}> {
  // `orders:write`, not merely a session. This is a `"use server"` action that spends REAL KiriminAja
  // quota (one live rate call per invocation) and it was the only door into this file that any signed-in
  // store user could open — a `gudang` account, which the RBAC matrix deliberately keeps out of every
  // other shipping action, could loop it over the store's order numbers. It is also the read that
  // `createShipment` is paired with, so the two should demand the same capability.
  const session = await requireCapability("orders:write");
  if (!kiriminajaConfigured())
    return {
      ok: false,
      rates: [],
      error: `${SHIPPING_SERVICE} belum dikonfigurasi oleh platform (super-admin → Pengaturan).`,
    };

  const ctx = await withCurrentTenant(async (db) => {
    const [store] = await db.select({ city: schema.stores.city }).from(schema.stores).where(eq(schema.stores.id, session.storeId)).limit(1);
    const [settings] = await db
      .select({
        kecamatanId: schema.storeSettings.senderKecamatanId,
        kecamatanName: schema.storeSettings.senderKecamatanName,
      })
      .from(schema.storeSettings)
      .limit(1);
    const order = input.orderNumber
      ? (
          await db
            .select({
              id: schema.orders.id,
              districtId: schema.orders.shipDistrictId,
              city: schema.orders.city,
              subtotal: schema.orders.subtotalIdr,
              total: schema.orders.totalIdr,
            })
            .from(schema.orders)
            .where(eq(schema.orders.number, input.orderNumber))
            .limit(1)
        )[0]
      : undefined;
    const pkgRows = order ? await packageRows(db, order.id) : [];
    return { storeCity: store?.city ?? "Yogyakarta", settings, order, pkgRows };
  });

  // ORIGIN = the seller's saved pickup address (Pengaturan → Alamat) — the address the courier is
  // actually sent to. Only when it is missing do we fall back to a fuzzy match on the store's city,
  // and the label below says so.
  let origin = ctx.settings?.kecamatanId ?? undefined;
  let originName = ctx.settings?.kecamatanName ?? "";
  if (!origin) {
    const opts = await resolveArea(ctx.storeCity, 1);
    origin = opts[0]?.id;
    originName = opts[0]?.text ? `${opts[0].text} (perkiraan — alamat jemput belum diatur)` : ctx.storeCity;
  }
  if (!origin)
    return {
      ok: false,
      rates: [],
      error: "Alamat pengambilan toko belum diatur (Pengaturan → Alamat).",
    };

  // DESTINATION — the order's own district id first; a city name only when there is no snapshot.
  let destination = ctx.order?.districtId ?? undefined;
  let destinationName = "";
  if (destination) {
    destinationName = (await provinceForDistrict(destination)) ? `${ctx.order?.city ?? ""} (kecamatan tujuan pesanan)`.trim() : String(destination);
  } else if (ctx.order?.city) {
    // Pre-0042 orders carry no district snapshot. Fuzzy-match their city — and SAY it is a guess.
    // `resolveArea("Surabaya")[0]` once returned "Bandar Surabaya, Lampung Tengah, LAMPUNG": the
    // parcel was priced 7,5x too high and booked to the wrong island. Never silently.
    const destOpts = await resolveArea(ctx.order.city, 1);
    destination = destOpts[0]?.id;
    destinationName = destOpts[0]?.text ? `${destOpts[0].text} (perkiraan dari nama kota)` : ctx.order.city;
  }
  if (!destination)
    return {
      ok: false,
      rates: [],
      error: "Kecamatan tujuan pesanan tidak diketahui — pesanan ini tidak bisa dihitung ongkirnya.",
    };

  const actualWeight = ctx.pkgRows.reduce((sum, row) => sum + (row.weight ?? 0) * (row.qty ?? 1), 0);
  const weight = Math.max(1000, actualWeight);
  // ONE rule for the box (`stackedDims`): the quote here, the checkout quote and the booking below
  // must all describe the parcel the vendor prices — Σ item volumes, not the largest item.
  const { lengthCm, widthCm, heightCm } = stackedDims(ctx.pkgRows);
  const itemValue = Number(ctx.order?.subtotal ?? 0);
  const r = await kaShippingPrice({
    origin,
    destination,
    weight,
    lengthCm,
    widthCm,
    heightCm,
    itemValue,
    // Quoted WITH insurance so every rate carries its insurance fee: the booking's `insurance_amount`
    // must be that number (KiriminAja's UAT review, 2026-09-14), and a `force_insurance` service
    // needs it even when the seller did not ask. `cost` is the same either way (the fee is its own
    // field), so the checkout quote (insurance 0) and this one still agree to the rupiah.
    insurance: 1,
  });
  if (!r.ok)
    return {
      ok: false,
      rates: [],
      error: r.error ?? `Gagal mengambil tarif dari ${SHIPPING_SERVICE}.`,
    };
  const scope = await shippingScope(session.storeId);
  // Same EFFECTIVE COD flag the storefront sees (lib/cod.ts): the merchant's own switch + the
  // platform's per-service allowance. Booking a COD shipment on a service the platform disallowed
  // is exactly the return-cost trap cod_enabled exists to prevent — so it isn't offered here either.
  const cod = await getCodPolicy(session.storeId);
  return {
    ok: true,
    origin: originName,
    destination: destinationName,
    codEnabled: cod.enabled,
    rates: r.results
      // Instant couriers are out of scope (@tokophi/lib/couriers) — they cannot be booked, so they
      // are never quoted. KiriminAja's express endpoint does not return them today; this is a guard.
      .filter((x) => !isInstantService({ courier: x.service, group: x.group }))
      // …and only what the platform allows and this store actually offers (see shippingScope).
      .filter((x) => inScope(scope, x.service, x.service_type))
      .map((x) => ({
        service: x.service_name,
        code: x.service,
        type: x.service_type,
        cost: Number(x.cost),
        etd: x.etd,
        cod: x.cod && cod.allows(x.service, x.service_type),
        group: x.group,
        codFee: kaCodFee(x),
        // The vendor's insurance fee for THIS quote (IDR) and whether the service insures regardless.
        insurance: Math.max(0, Math.round(Number(x.insurance) || 0)),
        forceInsurance: !!x.force_insurance,
      })),
  };
}

// ---- KiriminAja area autocomplete (sender-address picker) ----
export async function searchArea(q: string): Promise<{ id: number; text: string }[]> {
  if (!(await getSession())) return [];
  if (!q.trim()) return [];
  return resolveArea(q.trim());
}

/**
 * Kelurahan of a district, for the pickup-address form.
 *
 * `kaCreateOrder` already sends `kelurahan_id` when we have one — a kecamatan can span a large
 * area, and the courier's pickup rider is dispatched more precisely with the village. The column
 * (`store_settings.sender_kelurahan_id`) and the booking field both existed; the FORM never asked
 * for it, so it was NULL for every store and the precision was thrown away.
 *
 * Districts with no kelurahan rows (~4% — unmatched against the Kemendagri set) return []; the
 * caller must let the seller save without one rather than block them on data we do not have.
 *
 * 🔴 `kaKelurahanId` IS THE ONLY VALUE THAT MAY REACH `sender_kelurahan_id` (Task 8.17). It is
 * KiriminAja's own subdistrict id, from `POST /api/mitra/kelurahan`. The row's PRIMARY key is a
 * Kemendagri code ("34.02.07.2001") and it is deliberately NOT returned here — it is not a courier
 * id, and a form that can see it is a form that can send it. `null` = we could not match one
 * (6,0% of rows — 4 747 of 78 764, measured by the full walk of 2026-09-10), and the caller must
 * save NULL rather than substitute anything.
 */
export async function kelurahanOptions(
  districtId: number,
): Promise<{ name: string; postcode: string; kaKelurahanId: number | null }[]> {
  if (!(await getSession())) return [];
  if (!Number.isFinite(districtId) || districtId <= 0) return [];
  return kelurahanWithKaIdForDistrict(districtId);
}

// No lat/lng — instant (same-day) couriers were removed and they were the only consumer of the
// coordinates. `store_settings.sender_lat/sender_lng` still exist in the DB but are DEAD: neither
// read nor written here. Don't wire them back.
export type SenderAddress = {
  name: string;
  phone: string;
  address: string;
  kecamatanId: number | null;
  kecamatanName: string;
  kelurahanId: number | null;
  kelurahanName: string;
  postcode: string;
};

export async function getSenderAddress(): Promise<SenderAddress | null> {
  if (!(await getSession())) return null;
  return withCurrentTenant(async (db) => {
    const [s] = await db.select().from(schema.storeSettings).limit(1);
    if (!s) return null;
    return {
      name: s.senderName ?? "",
      phone: s.senderPhone ?? "",
      address: s.senderAddress ?? "",
      kecamatanId: s.senderKecamatanId ?? null,
      kecamatanName: s.senderKecamatanName ?? "",
      kelurahanId: s.senderKelurahanId ?? null,
      kelurahanName: s.senderKelurahanName ?? "",
      postcode: s.senderPostcode ?? "",
    };
  });
}

// composePickupAddress lives in lib/pickup-address.ts — a pure, client-safe module — so the Seller's
// Alamat Pengirim card previews the EXACT string this booking sends. See the note there for why the
// kelurahan + postcode have to ride inside the address text.

export async function saveSenderAddress(input: { name: string; phone: string; address: string; kecamatanId: number | null; kecamatanName: string; kelurahanId?: number | null; kelurahanName?: string; postcode?: string }): Promise<{ ok: boolean; error?: string }> {
  const { storeId } = await requireCapability("settings:write");
  // 5 digits or nothing. Normalised, not rejected — an odd postcode must never block saving an
  // address (same rule as the phone below); it just doesn't get written.
  const postcode = (input.postcode ?? "").replace(/\D/g, "");
  // 🔴 THE KELURAHAN ID IS RE-DERIVED, NEVER TRUSTED (Task 8.17). What arrives is a number from a
  // form; what may be stored is KiriminAja's own subdistrict id for a kelurahan that is actually IN
  // the chosen district. A value that does not resolve is dropped to NULL — the booking then omits
  // the field, which is the behaviour that has always shipped. Storing an unverified id would put a
  // stranger's subdistrict on a pickup request, and nothing downstream could tell.
  const kelurahanId =
    input.kecamatanId && input.kelurahanId
      ? ((await kelurahanWithKaIdForDistrict(input.kecamatanId)).some((k) => k.kaKelurahanId === input.kelurahanId)
          ? input.kelurahanId
          : null)
      : null;
  const values = {
    senderPostcode: /^\d{5}$/.test(postcode) ? postcode : null,
    senderName: input.name,
    // Canonical `62…` (the shape KiriminAja books `sender.phone` against). Normalised, NOT rejected:
    // if the seller's number cannot be parsed we still save what they typed — refusing to save an
    // address because of a phone format would be a worse bug than the format.
    senderPhone: normalizePhone(input.phone) ?? input.phone,
    senderAddress: input.address,
    senderKecamatanId: input.kecamatanId,
    senderKecamatanName: input.kecamatanName,
    senderKelurahanId: kelurahanId,
    senderKelurahanName: input.kelurahanName ?? "",
  };
  await withTenant(storeId, (db) =>
    db
      .insert(schema.storeSettings)
      .values({ storeId, ...values })
      .onConflictDoUpdate({
        target: schema.storeSettings.storeId,
        set: values,
      }),
  );
  revalidatePath("/pengaturan");
  return { ok: true };
}

// ⚠️ REMOVED: getCouriers() / getPlatformCouriers() / saveCouriers() — the COURIER-level selection
// (store_settings.couriers, a text[] of courier codes).
//
// They had no callers: the Jasa Kirim card writes store_shipping_methods (per SERVICE) and nothing
// in the app has written store_settings.couriers since. The column is NULL for every store in the
// database (checked 2026-07-14). Keeping the actions around is how the column comes back: the model
// cannot even express "JNE Reguler yes, JNE YES no", which is the whole reason the per-service table
// exists, and a second, coarser writer would silently override the finer one at checkout.
// `/api/public/ongkir` still reads the column as a legacy fallback (`merchant`); with nothing writing
// it, it is permanently NULL and the per-service filter is the only one in force. That fallback
// should go with the column — see the report.

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

type StoredService = {
  type: string;
  name: string;
  group: string;
  cod: boolean;
  codAllowed?: boolean;
};

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
    // Instant / on-demand couriers (GoSend, Grab…) are out of scope — the Jasa Kirim card must not
    // offer them even if a stale row survived in platform_couriers (@tokophi/lib/couriers).
    if (isInstantCourier(r.courier)) continue;
    const list = (r.services as StoredService[] | null) ?? [];
    for (const s of list) {
      // Legacy rows stored plain strings ("REG"). Skip them — they carry no group/cod and the
      // sync will replace them on the next run.
      if (typeof s !== "object" || !s.type) continue;
      if (isInstantService({ courier: r.courier, group: s.group })) continue;
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
    return rows
      .filter((r) => r.enabled && !isInstantCourier(r.courier)) // instant is out of scope — never offered
      .map((r) => ({ courier: r.courier, type: r.service }));
  });
}

export async function saveStoreServices(services: { courier: string; type: string }[]): Promise<{ ok: boolean; error?: string }> {
  const { storeId } = await requireCapability("settings:write");
  // The UI cannot show an instant courier, but the action is the boundary — a hand-posted payload
  // must not persist one either (@tokophi/lib/couriers).
  const clean = services.filter((s) => !isInstantCourier(s.courier));
  await withTenant(storeId, async (db) => {
    // full replace — the UI always sends the complete set
    await db.delete(schema.storeShippingMethods);
    if (clean.length) {
      await db.insert(schema.storeShippingMethods).values(
        clean.map((s) => ({
          storeId,
          courier: s.courier,
          service: s.type,
          enabled: true,
        })),
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
      .onConflictDoUpdate({
        target: schema.storeSettings.storeId,
        set: { codEnabled: on },
      }),
  );
  revalidatePath("/pengaturan");
  return { ok: true };
}

/** Automatic free shipping (PROMO P1, store_settings.free_ship_*). subtotal ≥ minIdr ⇒ ongkir gratis. */
export async function getFreeShip(): Promise<{
  enabled: boolean;
  minIdr: number;
}> {
  if (!(await getSession())) return { enabled: false, minIdr: 0 };
  return withCurrentTenant(async (db) => {
    const [s] = await db
      .select({
        enabled: schema.storeSettings.freeShipEnabled,
        minIdr: schema.storeSettings.freeShipMinIdr,
      })
      .from(schema.storeSettings)
      .limit(1);
    return { enabled: !!s?.enabled, minIdr: s?.minIdr ?? 0 };
  });
}

export async function setFreeShip(input: { enabled: boolean; minIdr: number }): Promise<{ ok: boolean }> {
  const { storeId } = await requireCapability("settings:write");
  const minIdr = Math.max(0, Math.round(input.minIdr || 0));
  await withTenant(storeId, (db) =>
    db
      .insert(schema.storeSettings)
      .values({
        storeId,
        freeShipEnabled: input.enabled,
        freeShipMinIdr: minIdr,
      })
      .onConflictDoUpdate({
        target: schema.storeSettings.storeId,
        set: { freeShipEnabled: input.enabled, freeShipMinIdr: minIdr },
      }),
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
  /**
   * The order carried no `ship_district_id` (pre-0042), so the destination district was FUZZY-MATCHED
   * from its free-text city — this is the district name we guessed and booked to. The parcel is on its
   * way; the merchant has to confirm it is the right one. Set = a guess succeeded, and a guess must
   * never succeed quietly.
   */
  destinationGuessed?: string;
};

export async function createShipment(input: { orderNumber: string; service: string; serviceType: string; serviceName: string; cost: number; insurance?: boolean; cod?: boolean }): Promise<CreateShipmentResult> {
  const { storeId } = await requireCapability("orders:write");
  if (!kiriminajaConfigured())
    return {
      ok: false,
      error: `${SHIPPING_SERVICE} belum dikonfigurasi oleh platform.`,
    };
  // A shipment can only be booked with an expedition courier — the instant (rider) booking path was
  // removed with the feature (@tokophi/lib/couriers). This is the boundary, not the UI.
  if (isInstantCourier(input.service)) {
    return {
      ok: false,
      error: "Kurir instan tidak didukung — gunakan layanan ekspedisi.",
    };
  }

  // The service must be one the PLATFORM enables and this store OFFERS. The rate list already
  // filters both (shippingScope), but the UI is UX and this is the boundary: a hand-posted payload
  // must not book a courier the platform switched off.
  const scope = await shippingScope(storeId);
  if (!inScope(scope, input.service, input.serviceType)) {
    return {
      ok: false,
      error: `Layanan ${input.serviceName} tidak aktif untuk toko ini (Pengaturan → Jasa Kirim).`,
    };
  }

  const data = await withTenant(storeId, async (db) => {
    const [s] = await db.select().from(schema.storeSettings).where(eq(schema.storeSettings.storeId, storeId)).limit(1);
    const [o] = await db
      .select({
        id: schema.orders.id,
        number: schema.orders.number,
        city: schema.orders.city,
        province: schema.orders.province,
        awb: schema.orders.awb,
        kaOrderId: schema.orders.kaOrderId,
        status: schema.orders.status,
        subtotal: schema.orders.subtotalIdr,
        shipping: schema.orders.shippingIdr,
        total: schema.orders.totalIdr,
        // Address SNAPSHOT (migration 0042) — where THIS parcel goes. See the note below.
        shipRecipient: schema.orders.shipRecipient,
        shipPhone: schema.orders.shipPhone,
        shipAddress: schema.orders.shipAddress,
        shipPostcode: schema.orders.shipPostcode,
        shipDistrictId: schema.orders.shipDistrictId,
        shipKelurahanId: schema.orders.shipKelurahanId,
        custName: schema.customers.name,
        custPhone: schema.customers.phone,
        // ⚠️ Whether this parcel is COD is a FACT ABOUT THE ORDER, not a checkbox. See the booking below.
        //
        // 🔴 THE `.as(…)` ALIASES ARE LOAD-BEARING — WITHOUT THEM THESE TWO ARE ONE COLUMN.
        // Postgres names an unaliased `exists (…)` expression **`exists`**, so two of them in one
        // target list come back as a single `exists` column and the second value is lost. Measured
        // on real Postgres, one prepaid order (`payments.method='transfer'`, `status='berhasil'`):
        // the same query read `hasSuccessfulPayment: false` while an aliased raw-SQL query over the
        // identical row read `true`. `isCod` (the first) was correct, which is what made it
        // survivable and invisible — the failure lands entirely on the SECOND expression.
        // Two guards below key off exactly that value, so a genuinely paid order was refused a
        // waybill. Never put two unaliased SQL expressions in one `.select({…})`.
        // 🔴 THE TABLE NAME IN THESE SUBQUERIES IS LOAD-BEARING. Do NOT go back to `${schema.orders.id}`.
        // Drizzle renders an interpolated column inside a `sql` template **UNQUALIFIED** — the SQL it
        // emits is `p.order_id = "id"`, not `p.order_id = "orders"."id"` (measured with `.toSQL()`).
        // Inside a correlated subquery the INNER scope wins, and `payments` has its own `id`, so the
        // condition silently became `p.order_id = p.id` — true for no row that has ever existed. Both
        // flags therefore read FALSE for every order, and the two guards keyed off them refused the
        // booking: a genuinely paid order was told "Pembayaran belum berhasil." Measured on real
        // Postgres — unqualified `false`, `"orders"."id"` `true`, same row, same transaction.
        isCod: sql<boolean>`exists (select 1 from payments p where p.order_id = "orders"."id" and p.method = 'cod')`.as("is_cod"),
        hasSuccessfulPayment: sql<boolean>`exists (
          select 1 from payments p
           where p.order_id = "orders"."id" and p.status = 'berhasil'
        )`.as("has_successful_payment"),
      })
      .from(schema.orders)
      .leftJoin(schema.customers, eq(schema.customers.id, schema.orders.customerId))
      .where(eq(schema.orders.number, input.orderNumber))
      .limit(1);
    // real package weight (sum of variant weight × qty) + dimensions (max per axis across items)
    const pkgRows = o ? await packageRows(db, o.id) : [];
    return { s, o, pkgRows };
  });

  const s = data.s;
  const o = data.o;
  if (!o) return { ok: false, error: "Pesanan tidak ditemukan." };
  if (o.awb) return { ok: false, error: `Pesanan sudah punya resi (${o.awb}).` };
  // A caller that explicitly asks for the opposite of the order's own payment method is confused
  // about which order it is booking — refuse rather than quietly correct it.
  if (input.cod !== undefined && !!input.cod !== !!o.isCod) {
    return {
      ok: false,
      error: o.isCod ? `Pesanan ${o.number} dibayar COD — resi harus dibuat dengan penagihan COD.` : `Pesanan ${o.number} sudah dibayar di muka — resi tidak boleh menagih COD lagi.`,
    };
  }
  if (!o.isCod && !o.hasSuccessfulPayment) {
    return {
      ok: false,
      error: `Pesanan ${o.number} belum dibayar. Pengiriman prepaid hanya dapat dibuat setelah pembayaran berhasil.`,
    };
  }
  if (o.kaOrderId)
    return {
      ok: false,
      error: `Pesanan sudah dibooking ke kurir (${o.kaOrderId}).`,
    };
  // A terminal order cannot be booked — refuse BEFORE calling KiriminAja, so we never create a real
  // courier booking for an order we would then decline to record a status for. `batal`/`retur` the
  // state machine would refuse anyway; `selesai` it would NOT (see shipmentLocked), and for a
  // `selesai` COD order accepting this would mean un-completing a sale whose cash is already
  // collected and credited to the ledger.
  if (shipmentLocked(o.status)) {
    return {
      ok: false,
      error: `Pesanan sudah ${o.status} — tidak bisa dibuatkan pengiriman.`,
    };
  }

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
  // ── DESTINATION = the order's ADDRESS SNAPSHOT (migration 0042), not a city name ─────────────
  // What went to the courier before: `destination_kecamatan_id = resolveArea(o.city)[0].id` and
  // `destination_address = o.city`. Both are wrong, and they are wrong in the way that loses a
  // parcel rather than the way that looks untidy:
  //   · resolveArea() ilike-matches "%<city>%" over kiriminaja_areas with NO ordering — for
  //     "Surabaya" the first row is id 3175, "Bandar Surabaya, Lampung Tengah, **Lampung**". An
  //     order to Surabaya (Jawa Timur) was priced and BOOKED to Lampung. (Reproduced on the seeded
  //     DB, 2026-07-14; 624 of 701 orders carry a real ship_district_id that was simply ignored.)
  //   · the courier was handed the city as the street address, so the driver got "Surabaya" and no
  //     house to deliver to.
  // `orders.ship_district_id` IS a KiriminAja district id — the one the shopper picked and the one
  // the ongkir they PAID was quoted against. It is the only destination that cannot disagree with
  // where the parcel is going. The city fallback stays for pre-0042 orders and is flagged as a guess.
  // ⚠️ The comment above said the fallback "is flagged as a guess" and `destinationGuessed` did not
  // exist anywhere in the repo — the guess was booked in complete silence. 77 orders on the dev DB
  // carry no `ship_district_id`, so this branch is live, not theoretical.
  let destinationGuessed: string | undefined;
  let destDistrictId = o.shipDistrictId ?? null;
  if (!destDistrictId) {
    const guess = (await resolveArea(o.city ?? ""))[0];
    destDistrictId = guess?.id ?? null;
    // Name the district we actually picked, not the city we searched for. "Surabaya" matching
    // "Bandar Surabaya, Lampung Tengah, LAMPUNG" is only visible if we print the MATCH.
    destinationGuessed = guess?.text || o.city || undefined;
  }
  if (!destDistrictId)
    return {
      ok: false,
      error: `Area tujuan "${o.city}" tidak ditemukan di ${SHIPPING_SERVICE}.`,
    };
  const destAddress = o.shipAddress?.trim() || o.city || "-";
  if (!o.shipAddress?.trim()) {
    // Never book a parcel with no street. A courier cannot deliver to a city name.
    return {
      ok: false,
      error: `Alamat tujuan pesanan ${o.number} tidak lengkap (hanya kota "${o.city ?? "—"}", tanpa alamat jalan). Kurir tidak bisa mengantar tanpa alamat lengkap — hubungi pembeli dan lengkapi alamat pesanan.`,
    };
  }

  if (o.isCod) {
    const policy = await getCodPolicy(storeId);
    // The province is taken from the DISTRICT the parcel is booked to, not from the free-text
    // province on the order: platform_cod.allowed_provinces bounds a real financial risk, and a
    // typed string is a claim while a district id is where the parcel physically goes (lib/data/areas).
    const province = (await provinceForDistrict(destDistrictId)) ?? o.province;
    const reason = policy.reason({
      courier: input.service,
      serviceType: input.serviceType,
      total: Number(o.total),
      province,
    });
    if (reason) return { ok: false, error: reason };
  }

  // Re-price the chosen service on the server immediately before booking. `input.cost` is display
  // state from the browser and is deliberately ignored here.
  const live = await getShippingRates({ orderNumber: input.orderNumber });
  if (!live.ok)
    return {
      ok: false,
      error: live.error ?? "Tarif pengiriman tidak dapat diperbarui.",
    };
  const selectedRate = live.rates.find((rate) => rate.code === input.service && rate.type === input.serviceType);
  if (!selectedRate) {
    return {
      ok: false,
      error: "Layanan ini tidak tersedia pada tarif terbaru. Pilih layanan lain.",
    };
  }
  const serverCost = Math.max(0, Math.round(selectedRate.cost));
  const insured = !!input.insurance || selectedRate.forceInsurance;
  if (serverCost !== Math.max(0, Math.round(input.cost))) {
    return {
      ok: false,
      error: `Tarif berubah menjadi Rp${serverCost.toLocaleString("id-ID")}. Periksa dan konfirmasi ulang sebelum booking.`,
    };
  }
  const bookingId = crypto.randomUUID();
  // ⚠️ `providerReference` is NOT built here any more (Task 8.20). It used to be
  // `orderNumber-without-punctuation + 8 characters of this UUID`, which is 28 characters once
  // `kiriminaja.ts` prefixes it — and `POST /api/mitra/tracking` declares `order_id`
  // `maxLength: 20`, so every parcel we booked was one the poller could never ask about. The
  // replacement needs the order's booking COUNT, so it is built inside the reservation below,
  // under the same advisory lock — see `buildKaOrderRef` for the length and collision arithmetic.

  // Reserve the surcharge before calling KiriminAja. The same per-store advisory lock is used by
  // requestPayout(), so a withdrawal cannot race this debit.
  const reservation = await withTenant(storeId, async (db) => {
    await db.execute(sql`select pg_advisory_xact_lock(hashtext(${storeId})::bigint)`);
    const [locked] = await db
      .select({
        id: schema.orders.id,
        status: schema.orders.status,
        kaOrderId: schema.orders.kaOrderId,
        // How many times this order has been booked before. It is the `attempt` half of the
        // provider reference (Task 8.20): a COUNTER read under the lock, so two bookings of one
        // order cannot mint the same id, where a random tail that short would collide constantly.
        // Aliased, like the two `exists` below, and read in the same round trip as the row lock.
        priorBookings: sql<number>`(
          select count(*) from shipment_bookings sb where sb.order_id = "orders"."id"
        )`.as("prior_bookings"),
        // Aliased for the reason spelled out at the first read of these two columns: two unaliased
        // `exists (…)` expressions collapse into ONE `exists` column and the second is lost. This is
        // the copy that actually refused the booking in the measured reproduction.
        isCod: sql<boolean>`exists (
          select 1 from payments p
           where p.order_id = "orders"."id" and p.method = 'cod'
        )`.as("is_cod"),
        hasSuccessfulPayment: sql<boolean>`exists (
          select 1 from payments p
           where p.order_id = "orders"."id" and p.status = 'berhasil'
        )`.as("has_successful_payment"),
      })
      .from(schema.orders)
      .where(eq(schema.orders.number, input.orderNumber))
      .limit(1)
      .for("update");
    if (!locked || shipmentLocked(locked.status)) {
      return {
        ok: false as const,
        error: "Pesanan tidak lagi dapat dibuatkan pengiriman.",
      };
    }
    if (locked.kaOrderId) {
      return {
        ok: false as const,
        error: `Pesanan sudah dibooking ke kurir (${locked.kaOrderId}).`,
      };
    }
    if (!locked.isCod && !locked.hasSuccessfulPayment) {
      return {
        ok: false as const,
        error: "Pembayaran belum berhasil. Pengiriman tidak jadi direservasi.",
      };
    }
    const [existing] = await db
      .select({ status: schema.shipmentBookings.status })
      .from(schema.shipmentBookings)
      .where(
        sql`${schema.shipmentBookings.orderId} = ${locked.id}
          and ${schema.shipmentBookings.status} in ('reserved', 'unknown', 'accepted', 'cancellation_requested')`,
      )
      .limit(1);
    if (existing) {
      return {
        ok: false as const,
        error: existing.status === "unknown" ? "Status booking sebelumnya belum diketahui. Jangan booking ulang; rekonsiliasikan referensi provider lebih dulu." : existing.status === "cancellation_requested" ? "Pembatalan pengiriman masih diproses kurir." : "Pengiriman sedang atau sudah dibooking. Muat ulang pesanan.",
      };
    }

    // Built here, not before the lock: the attempt counter is only exact while the row is held.
    // A failure is a MISCONFIGURATION (a `KIRIMINAJA_ORDER_PREFIX` too long to leave a usable
    // reference, or a 37th booking of one order), so it is logged loudly and refused — never
    // shortened silently into an id the vendor would store and we could never query.
    let providerReference: string;
    try {
      providerReference = buildKaOrderRef(input.orderNumber, Number(locked.priorBookings ?? 0));
    } catch (e) {
      console.error("[shipping] cannot build a KiriminAja order_id", e);
      return {
        ok: false as const,
        error: "Referensi pengiriman tidak dapat dibuat. Hubungi dukungan sebelum mencoba lagi.",
      };
    }

    const [money] = await db
      .select({
        shippingCharged: schema.orderFinancials.shippingChargedIdr,
        goodsProceeds: schema.orderFinancials.goodsProceedsIdr,
      })
      .from(schema.orderFinancials)
      .where(eq(schema.orderFinancials.orderId, locked.id))
      .limit(1);
    const shippingCharged = Number(money?.shippingCharged ?? o.shipping ?? 0);
    const sellerDebit = Math.max(0, serverCost - shippingCharged);
    const platformMargin = Math.max(0, shippingCharged - serverCost);
    const orderDebit = Math.min(sellerDebit, Number(money?.goodsProceeds ?? 0));
    const balanceDebit = sellerDebit - orderDebit;
    const [balance] = (await db.execute(sql`
      select coalesce(sum(amount_idr), 0)::bigint as available
        from ledger_entries
       where store_id = ${storeId} and status = 'available'
    `)) as unknown as { available: string | number }[];
    if (balanceDebit > Number(balance?.available ?? 0)) {
      return {
        ok: false as const,
        error: `Saldo Seller tidak cukup untuk selisih ongkir Rp${sellerDebit.toLocaleString("id-ID")}.`,
      };
    }

    await db.insert(schema.shipmentBookings).values({
      id: bookingId,
      storeId,
      orderId: locked.id,
      providerReference,
      courier: input.service,
      serviceType: input.serviceType,
      serviceName: selectedRate.service,
      status: "reserved",
      shippingChargedIdr: shippingCharged,
      shippingActualIdr: serverCost,
      shippingDeltaIdr: serverCost - shippingCharged,
      sellerDebitIdr: sellerDebit,
      platformMarginIdr: platformMargin,
    });
    if (orderDebit > 0) {
      await db.insert(schema.ledgerEntries).values({
        storeId,
        orderId: locked.id,
        shipmentBookingId: bookingId,
        component: "shipping-order-debit",
        kind: "adjustment",
        status: "pending",
        amountIdr: -orderDebit,
        note: `Selisih ongkir ${input.orderNumber}`,
      });
    }
    if (balanceDebit > 0) {
      await db.insert(schema.ledgerEntries).values({
        storeId,
        orderId: locked.id,
        shipmentBookingId: bookingId,
        component: "shipping-balance-debit",
        kind: "adjustment",
        status: "available",
        amountIdr: -balanceDebit,
        note: `Selisih ongkir ${input.orderNumber}`,
        availableAt: new Date(),
      });
    }
    return { ok: true as const, providerReference };
  });
  if (!reservation.ok) return reservation;
  const providerReference = reservation.providerReference;

  // Pickup = TOMORROW 10:00 WIB. The date must be computed in Asia/Jakarta, not in the server's
  // timezone, or a UTC box books the wrong day. 10:00 and not 15:00 because couriers enforce a
  // daily cut-off and reject anything past it — the sandbox rejects J&T outright at 15:00
  // ("telah melewati batas pemrosesan ekspedisi (Pukul 14:53:00 WIB)").
  const jkt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const schedule = `${jkt} 10:00:00`;
  // real package weight (Σ variant weight × qty, ≥1kg) + dimensions (max per axis across items)
  const pkgRows = data.pkgRows;
  const actualWeight = pkgRows.reduce((a, r) => a + (r.weight ?? 0) * (r.qty ?? 1), 0);
  const weight = Math.max(1000, actualWeight);
  // The SAME box the quote priced (`stackedDims`, see shipping-weight.ts): Σ item volumes stacked on
  // the largest footprint. The v6.2 validator prices `items[]` (measured 2026-09-14), so the package
  // dimensions, the quote and the manifest below all have to agree.
  const { lengthCm: length, widthCm: width, heightCm: height } = stackedDims(pkgRows);

  // ── The v6.2 spec-required fields we can honestly produce (Task 8.14) ───────────────────────
  // Both zipcodes: the stored one first — the shopper's kodepos has been REQUIRED at checkout
  // since 2026-08-03 and the seller's comes from the kelurahan they picked — then the district's
  // own postcode when that district has exactly one. Never a placeholder: a missing postal code is
  // omitted from the payload, because "00000" is a value a sorting hub would act on.
  const senderZipcode = s.senderPostcode?.trim() || (await soleDistrictPostcode(s.senderKecamatanId));
  const destZipcode = o.shipPostcode?.trim() || (await soleDistrictPostcode(destDistrictId));
  // The manifest, one entry per order line — the spec requires `items` and `minItems: 1`, and a
  // single synthetic "Pesanan INV-…" line is what `item_name` already says. Every numeric field in
  // that schema carries `minimum: 1`, so each is floored: a line whose variant has no weight sends
  // 1 g rather than 0 (the PACKAGE weight above is the real, priced one), and the box dimensions
  // fall back to the same values the package declares, so a line can never contradict its parcel.
  const items = pkgRows.map((row) => ({
    name: row.title?.trim() || "Barang",
    price: Math.max(0, Number(row.unitPrice ?? 0)),
    weight: Math.max(1, row.weight ?? 0),
    qty: Math.max(1, row.qty ?? 1),
    // The line's OWN box, never the parcel's: the vendor sums items[] volumes × qty, so a line that
    // borrowed the package dimensions would count the whole parcel once per line and per unit. A
    // product that declared none sends the schema minimum (1 cm) — no volume it never claimed.
    width: Math.max(1, row.w ?? 1),
    length: Math.max(1, row.l ?? 1),
    height: Math.max(1, row.h ?? 1),
    // "Default" is drizzle's placeholder for a product with no options, not a variant label.
    metadata: { sku: row.sku?.trim() || null, variant_label: row.variantTitle && row.variantTitle !== "Default" ? row.variantTitle : null },
  }));
  // Coordinates (0109): the centroid of the smallest area each address is known to be in. The
  // destination kelurahan is trusted only when the district is the one it was derived against —
  // the same guard `destKelurahanId` below applies — and `resolveAreaCoords` returns null rather
  // than a coordinate for a mismatched pair. Null ⇒ the fields are omitted, never 0,0. Reference
  // tables, no tenant → the owner handle, exactly as `resolveArea` above.
  const destKelurahanForBooking = destDistrictId === o.shipDistrictId ? o.shipKelurahanId : null;
  const [senderCoords, destCoords] = await Promise.all([
    resolveAreaCoords(db, { districtId: s.senderKecamatanId, kaKelurahanId: s.senderKelurahanId }),
    resolveAreaCoords(db, { districtId: destDistrictId, kaKelurahanId: destKelurahanForBooking }),
  ]);

  let r: Awaited<ReturnType<typeof kaCreateOrder>>;
  try {
    r = await kaCreateOrder(
      {
        name: s.senderName || "Toko",
        phone: s.senderPhone || "081200000000",
        address:
          composePickupAddress({
            address: s.senderAddress,
            kelurahanName: s.senderKelurahanName,
            postcode: s.senderPostcode,
          }) || "-",
        kecamatanId: s.senderKecamatanId,
        kelurahanId: s.senderKelurahanId,
        zipcode: senderZipcode,
        latitude: senderCoords?.lat,
        longitude: senderCoords?.lng,
      },
      {
        orderRef: providerReference,
        destName: o.shipRecipient?.trim() || o.custName || "Penerima",
        destPhone: o.shipPhone?.trim() || o.custPhone || "081200000000",
        destAddress,
        destKecamatanId: destDistrictId,
        // 🔴 ONLY WHEN THE DISTRICT IS THE ONE THE ID WAS DERIVED AGAINST. `destDistrictId` may be
        // a GUESS — 77 orders carry no `ship_district_id` and the branch above resolves one from
        // the typed city, which is how "Surabaya" became "Bandar Surabaya, Lampung Tengah". A
        // subdistrict id belongs to exactly one district, so pairing a stored id with a guessed
        // district would send the courier a village that is not in the kecamatan on the same
        // request — a wrong id, which this whole task exists to avoid. Guessed ⇒ omit.
        destKelurahanId: destKelurahanForBooking,
        destZipcode: destZipcode || undefined,
        destLatitude: destCoords?.lat,
        destLongitude: destCoords?.lng,
        weight,
        width,
        length,
        height,
        itemValue: o.subtotal || o.total || 0,
        itemName: `Pesanan ${o.number}`,
        service: input.service,
        serviceType: input.serviceType,
        shippingCost: serverCost,
        // COD value = goods + shipping + the COD fee (3% + PPN 11% on goods + shipping, the platform
        // schedule) — which is exactly `orders.total_idr` at checkout, and exactly KiriminAja's own
        // formula (T&C §5, 2026-09-14) for an uninsured parcel. Insurance on a COD parcel is the
        // SELLER's choice at booking, after the buyer's total was fixed, so it is the seller's cost
        // and is deliberately NOT added to what the courier collects.
        cod: o.isCod ? o.total || o.subtotal || 0 : 0,
        // KiriminAja's UAT review (2026-09-14): `insurance_amount` is the `insurance` FEE the pricing
        // call returned for this service — never the goods value — and a `force_insurance` service
        // carries it whether or not the seller ticked the box.
        insuranceAmount: insured ? selectedRate.insurance : 0,
        items,
      },
      schedule,
    );
  } catch (error) {
    // A timeout/non-JSON 5xx is not a rejection: the provider may have accepted the booking and
    // lost only the response. Keep the debit reserved and block retries until the stable provider
    // reference is reconciled. Reversing here would fund a second booking against the same order.
    await withTenant(storeId, async (db) => {
      await db
        .update(schema.shipmentBookings)
        .set({
          status: "unknown",
          failureNote: "Respons provider tidak diterima; status wajib direkonsiliasi.",
        })
        .where(eq(schema.shipmentBookings.id, bookingId));
    });
    console.error("[shipping] booking outcome unknown", input.orderNumber, error instanceof Error ? error.name : "UnknownError");
    return {
      ok: false,
      error: `Status booking ${input.orderNumber} belum diketahui karena respons kurir terputus. ` + "Jangan booking ulang; hubungi support untuk rekonsiliasi referensi provider.",
    };
  }
  if (!r.ok) {
    await withTenant(storeId, async (db) => {
      await db.execute(sql`select pg_advisory_xact_lock(hashtext(${storeId})::bigint)`);
      await db
        .update(schema.shipmentBookings)
        .set({
          status: "failed",
          failureNote: (r.error ?? "Provider menolak booking").slice(0, 500),
        })
        .where(eq(schema.shipmentBookings.id, bookingId));
      await db.execute(sql`
        insert into ledger_entries
          (store_id, order_id, shipment_booking_id, component, kind, status, amount_idr, note, available_at)
        select store_id, order_id, shipment_booking_id, component || '-reversal', 'adjustment',
               status, -amount_idr, 'Pembatalan reservasi ongkir ' || ${input.orderNumber},
               case when status = 'available' then now() end
          from ledger_entries
         where shipment_booking_id = ${bookingId}
           and component in ('shipping-order-debit', 'shipping-balance-debit')
        on conflict do nothing
      `);
    });
    const e = (r.error ?? "").toLowerCase();
    // KiriminAja's rejections are actionable — surface WHAT to fix, not just that it failed.
    const hint = e.includes("prefix") ? " (konfigurasi pengiriman platform belum lengkap — hubungi dukungan TokoΦ)" : e.includes("batas pemrosesan") || e.includes("penjadwalan") ? " (kurir ini sudah melewati jam cut-off — coba layanan lain atau jadwalkan besok)" : "";
    return {
      ok: false,
      error: (r.error ?? "Gagal membuat pengiriman.") + hint,
    };
  }

  // Only a waybill KiriminAja actually returned lands in `awb`. Nothing is substituted for it.
  const awb = r.awb ?? null;

  // Persist the provider identity first. If the wider order update below fails, reconciliation still
  // has the exact outbound reference and KiriminAja booking id and must not book a second parcel.
  await withTenant(storeId, (db) =>
    db
      .update(schema.shipmentBookings)
      .set({
        status: "accepted",
        providerBookingId: r.kaOrderId ?? null,
        acceptedAt: new Date(),
      })
      .where(eq(schema.shipmentBookings.id, bookingId)),
  );
  // ⚠️ The KiriminAja call above is OUTSIDE this transaction, and must stay there — never hold a row
  // lock across the network (the invariant ka-tracking.ts spells out).
  await withTenant(storeId, async (db) => {
    // Re-read UNDER LOCK. The guard before the booking ran against a read taken BEFORE the KiriminAja
    // round-trip, and the tracking poller writes this same row — it can advance the order to
    // `selesai`/`retur` while we are on the wire, and this write would then walk it back to
    // `diproses`. Same defect cancelShipment had; the booking window is merely narrower, which is the
    // only reason it is rarer rather than safer.
    const [cur] = await db.select({ id: schema.orders.id, status: schema.orders.status }).from(schema.orders).where(eq(schema.orders.number, input.orderNumber)).limit(1).for("update");
    if (!cur) return;

    // ── 1. The SHIPMENT fields. Not status, not the state machine's business — and written
    // UNCONDITIONALLY, because the booking DID happen at the courier no matter what the order's
    // status did while we were on the wire. Losing the reference here would strand a real pickup.
    //
    // `courier` takes the CODE (`spx`), never `serviceName` ("SPX Standard"). It held the display
    // name until 2026-07-16 and that quietly corrupted every booked order: `orders.courier` is a
    // JOIN KEY — to platform_couriers (which carries `codAllowed` and the `group` behind the
    // 1 day/reguler/ekonomi/cargo filter) and to the per-courier COD return report. "SPX Standard"
    // matches nothing, so a booked order silently vanished from all of them.
    // `serviceType` moves with it: the seller may book a DIFFERENT service than the shopper picked,
    // and leaving the old type behind pairs one courier with another's service — production had
    // exactly that (courier "SAP Satria Reg" carrying JNE's REG23).
    //
    // The three payment fields ride along for the same reason: the booking DID happen and the
    // courier's own bill is part of it. `pickup_number` is the vendor's `payment_id` — the handle
    // for asking "has this shipment been paid for?" — and it was returned and thrown away, along
    // with `payment_status` and the `qr_url` that settles it. For a NON-COD parcel we owe the
    // shipping cost, and an unpaid booking never gets a waybill: the parcel silently does not ship
    // while the order reads "dibooking". Stored verbatim; `lib/shipment-payment.ts` is the ONE place
    // that separates the COD flow (buyer pays the courier — nothing for us to settle) from the VA
    // flow, and it decides from the ORDER's COD flag, never from these columns.
    await db
      .update(schema.orders)
      .set({
        awb,
        courier: input.service,
        serviceType: input.serviceType,
        kaOrderId: r.kaOrderId,
        kaPickupNumber: r.pickupNumber ?? null,
        kaPaymentStatus: r.paymentStatus ?? null,
        kaPaymentUrl: r.paymentUrl ?? null,
        // The live server quote is the amount sent to KiriminAja and reserved in the ledger.
        kaShippingCostIdr: serverCost,
      })
      .where(eq(schema.orders.id, cur.id));

    // ── 2. The STATUS, through the ONE writer that owns it. A terminal order's status is no longer
    // ours to assert, so we do not even ask (shipmentLocked covers `selesai`, which the machine
    // itself would allow — that is the whole reason the predicate exists).
    //
    // `diproses`, NOT `dikirim`: a booking is not yet shipped — the AWB is still null and the courier
    // hasn't accepted pickup. Status follows the courier (ka-tracking's documented model), so the
    // poller advances this to `dikirim` the moment tracking shows pickup. Jumping to `dikirim` here
    // told every buyer "Dikirim" with no resi and no movement.
    //
    // Routing this through the state machine fires NO side effects, and that is a property of the
    // code rather than a hope: `restores` is `batal||retur` only, so no inventory is put back and no
    // pending payment is failed; and `settleOrderLedger` for `diproses` matches none of its three
    // branches — not `selesai` (no COD collection, no sale booked), not `releaseOn` (which is only
    // ever `selesai`|`dikirim`), not `retur`/`batal` (no claw-back). What we gain is its guards: a
    // re-booked order already at `diproses` is a no-op, and `batal`/`retur` are refused in the same
    // one place every other status change is refused.
    if (!shipmentLocked(cur.status)) {
      await applyOrderStatusChange(db, {
        storeId,
        order: { id: cur.id, status: cur.status as OrderStatus },
        status: "diproses",
      });
    }
  });
  revalidatePath(`/pesanan/${input.orderNumber}`);
  return {
    ok: true,
    awb,
    kaOrderId: r.kaOrderId,
    pickupNumber: r.pickupNumber,
    awbPending: !awb,
    destinationGuessed,
  };
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
export async function cancelShipment(orderNumber: string, reason = "Dibatalkan oleh penjual"): Promise<{ ok: boolean; pending?: boolean; error?: string }> {
  const { storeId } = await requireCapability("orders:write");
  const o = await withTenant(storeId, async (db) => {
    const [row] = await db
      .select({
        id: schema.orders.id,
        awb: schema.orders.awb,
        kaOrderId: schema.orders.kaOrderId,
        status: schema.orders.status,
        // Alone in this target list today, so it is correct today — aliased anyway, because "correct
        // until somebody adds a second one" is what the two guards above were, and the failure is
        // silent in both directions. The rule is the class, not the instance.
        cancellationPending: sql<boolean>`exists (
          select 1 from shipment_bookings b
           where b.order_id = "orders"."id"
             and b.status = 'cancellation_requested'
        )`.as("cancellation_pending"),
      })
      .from(schema.orders)
      .where(eq(schema.orders.number, orderNumber))
      .limit(1);
    return row ?? null;
  });
  if (!o?.awb && !o?.kaOrderId) {
    return { ok: false, error: "Pesanan ini belum punya pengiriman." };
  }
  if (o.cancellationPending) {
    return {
      ok: false,
      error: "Permintaan pembatalan sebelumnya masih diproses kurir.",
    };
  }
  if (!o.awb) {
    return {
      ok: false,
      error: "Nomor resi belum terbit dari kurir, dan pembatalan butuh nomor resi. " + "Klik “Lacak” untuk mengambil resi begitu terbit, lalu batalkan.",
    };
  }
  if (shipmentLocked(o.status)) {
    return {
      ok: false,
      error: `Pesanan sudah ${o.status} — pengirimannya tidak bisa dibatalkan lagi.`,
    };
  }

  // ── ① RECORD THE INTENT BEFORE THE VENDOR CALL (Task 5.1 / F-S12) ─────────────────────────
  // The local write used to come AFTER `kaCancelShipment`. A crash between the vendor accepting and
  // that write left the courier with a queued void the database knew nothing about — the fact was
  // lost, not merely late. Now the booking flips to `cancellation_requested` first, under the same
  // advisory lock + row lock as every other booking write, so whatever happens next the row says a
  // cancellation is in flight. The reconciler (`ka-tracking.ts` → `cancel-reconcile.ts`) reads it
  // back on every tracking tick and resolves it from what the courier actually reports.
  const intent = await withTenant(storeId, async (db) => {
    await db.execute(sql`select pg_advisory_xact_lock(hashtext(${storeId})::bigint)`);
    const [booking] = await db
      .select({ id: schema.shipmentBookings.id, status: schema.shipmentBookings.status })
      .from(schema.shipmentBookings)
      .where(
        sql`${schema.shipmentBookings.orderId} = ${o.id}
          and ${schema.shipmentBookings.status} in ('accepted', 'cancellation_requested')`,
      )
      .limit(1)
      .for("update");
    // Two clicks: the pre-guard above read `cancellationPending` outside this lock, so the loser
    // lands here and must not send a second request to the courier.
    if (booking?.status === "cancellation_requested") return { kind: "pending" as const };
    // Orders booked before `shipment_bookings` existed (0094) have no row to carry the intent. They
    // still get the vendor call — refusing them is a regression — but nothing durable can be
    // recorded, so the reconciler cannot see them and the poller's ordinary 300 → `batal` applies.
    if (!booking) return { kind: "legacy" as const };
    await db
      .update(schema.shipmentBookings)
      .set({
        status: "cancellation_requested",
        failureNote: "Pembatalan sedang diminta ke kurir; jawaban kurir belum tercatat.",
      })
      .where(eq(schema.shipmentBookings.id, booking.id));
    return { kind: "recorded" as const, bookingId: booking.id };
  });
  if (intent.kind === "pending") {
    return { ok: false, error: "Permintaan pembatalan sebelumnya masih diproses kurir." };
  }

  // ── ② THE VENDOR CALL ──────────────────────────────────────────────────────────────────────
  const ref = o.awb;
  let result: Awaited<ReturnType<typeof kaCancelShipment>>;
  try {
    result = await kaCancelShipment(ref, reason);
  } catch (error) {
    console.error("[shipping] cancellation request outcome unknown", orderNumber, error instanceof Error ? error.name : "UnknownError");
    // The request MAY have reached the courier. The intent stays recorded (`cancellation_requested`)
    // rather than being rolled back: if the void does land, tracking reports 300/302 and the
    // reconciler voids the booking; if the parcel moves instead, it reverts to `accepted`. Rolling
    // the row back here would be the lost fact this task exists to prevent.
    await recordCancelAnswer(storeId, intent, {
      status: "cancellation_requested",
      failureNote: "Respons kurir terputus saat meminta pembatalan; permintaan mungkin sudah diterima. Hasilnya diperiksa otomatis lewat pelacakan.",
    });
    revalidatePath(`/pesanan/${orderNumber}`);
    return {
      ok: false,
      pending: intent.kind === "recorded",
      error:
        "Respons kurir terputus saat meminta pembatalan. Permintaan tercatat dan hasilnya diperiksa otomatis lewat pelacakan; " +
        "periksa tracking sebelum mencoba lagi.",
    };
  }
  if (!result.ok) {
    // The courier refused: the shipment stands, so the booking goes back to `accepted`. The vendor's
    // wording is kept — this is the SELLER's screen, and "sudah melewati jam cut-off" is what they
    // act on (ADR 0004 hides provider text from SHOPPERS, not merchants).
    await recordCancelAnswer(storeId, intent, {
      status: "accepted",
      failureNote: `Kurir menolak pembatalan: ${(result.error ?? "gagal").slice(0, 400)}`,
    });
    revalidatePath(`/pesanan/${orderNumber}`);
    return {
      ok: false,
      error: `${SHIPPING_SERVICE} menolak pembatalan: ${result.error ?? "gagal"}. Pengiriman masih terdaftar di kurir.`,
    };
  }

  // ── ③ THE VENDOR'S ANSWER, RECORDED AFTER ────────────────────────────────────────────────
  // `status: true` means the request was QUEUED, not that the shipment was voided or its cost
  // refunded. The AWB, the provider ids and every debit stay until the reconciler confirms.
  await recordCancelAnswer(storeId, intent, {
    status: "cancellation_requested",
    failureNote: "Pembatalan diterima kurir; menunggu konfirmasi void/refund provider.",
  });
  revalidatePath(`/pesanan/${orderNumber}`);
  return { ok: true, pending: true };
}

/**
 * Best-effort: the durable fact (`cancellation_requested`) was written BEFORE the vendor call, so a
 * failure here loses only the note, never the state — which is why it logs instead of throwing. A
 * legacy order (no booking row) has nothing to update.
 */
async function recordCancelAnswer(
  storeId: string,
  intent: { kind: "recorded"; bookingId: string } | { kind: "legacy" },
  patch: { status: "accepted" | "cancellation_requested"; failureNote: string },
): Promise<void> {
  if (intent.kind !== "recorded") return;
  try {
    await withTenant(storeId, async (db) => {
      await db
        .update(schema.shipmentBookings)
        .set(patch)
        .where(
          sql`${schema.shipmentBookings.id} = ${intent.bookingId}
            and ${schema.shipmentBookings.status} = 'cancellation_requested'`,
        );
    });
  } catch (error) {
    console.error("[shipping] cancel answer not recorded; intent row stands", intent.bookingId, error instanceof Error ? error.name : "UnknownError");
  }
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
    const [o] = await db.select({ kaOrderId: schema.orders.kaOrderId, awb: schema.orders.awb }).from(schema.orders).where(eq(schema.orders.number, orderNumber)).limit(1);
    return o ?? null;
  });
  const ref = row?.kaOrderId ?? row?.awb ?? null;
  if (!ref)
    return {
      ok: false,
      message: "Pesanan ini belum punya pengiriman.",
      history: [],
    };

  const r = await kaTrack(ref);
  if (!r.ok) {
    const unavailable = /tidak tersedia|not available|belum/i.test(r.error ?? "");
    return {
      ok: false,
      pending: unavailable,
      kaOrderId: ref,
      awb: row?.awb ?? null,
      history: [],
      message: unavailable ? `${SHIPPING_SERVICE} belum punya data lacak untuk pengiriman ini — kurir belum menjemput/memproses paket. Nomor resi terbit setelah paket diproses kurir.` : (r.error ?? "Tracking belum tersedia."),
    };
  }

  // Parsed once in `kaTrack` (`details` + top-level `status_code` — this used to cast `r.data`, which
  // the response never has, so "Lacak" could never see a waybill the courier had already issued).
  const t = r.tracking ?? { awb: null, sortingCode: null, statusCode: null, text: null, histories: [], keys: [] };
  // Not our own ref echoed back, not the sandbox's `MOCK-<ref>` (realWaybill).
  const realAwb = realWaybill(t.awb, ref);
  if (realAwb || t.sortingCode) {
    // Through the ONE writer the poller and the webhook use, so a seller pressing "Lacak" and the
    // 15-minute tick cannot disagree about the order: AWB, sorting code, and the forward-only status
    // move together, inside one row lock. The order number was just read through RLS, so it is the
    // caller's own order; `orders.number` is globally unique.
    const outcome = outcomeFromTrackingCode(t.statusCode);
    await syncOrderFromKa(
      orderNumber,
      outcome,
      realAwb,
      outcome === "problem" ? `Kurir melaporkan kendala pengiriman (kode ${String(t.statusCode ?? "-")}).` : null,
      undefined,
      t.sortingCode,
    );
    revalidatePath(`/pesanan/${orderNumber}`);
  }
  const history = t.histories.map((h) => ({ date: h.date, desc: h.desc }));
  return {
    ok: true,
    awb: realAwb ?? row?.awb ?? null,
    kaOrderId: ref,
    status: t.text ?? (t.statusCode == null ? null : String(t.statusCode)),
    history,
    pending: history.length === 0,
    message: realAwb ? `Nomor resi kurir diterima: ${realAwb}` : history.length ? `Update terakhir: ${history[history.length - 1].desc}` : `Pengiriman terdaftar di ${SHIPPING_SERVICE} — belum ada pergerakan dari kurir.`,
  };
}

// DEMO/SANDBOX ONLY — stamp a clearly-marked placeholder AWB on an order so the "Cetak resi" flow can
// be previewed where the courier never issues a real waybill (sandbox). REFUSED in production: a fake
// AWB is a label no courier can scan — the exact anti-pattern `printLabel` guards against. The value is
// prefixed "DEMO" so it can never be mistaken for a real resi, and `trackShipment` will overwrite it
// with the real waybill the moment KiriminAja returns one.
export async function fillDemoResi(orderNumber: string): Promise<{ ok: boolean; error?: string; awb?: string }> {
  const { storeId } = await requireCapability("orders:write");
  // Task 8.33: the SAME seam the booking reads — a demo resi decided by a stale env var is a fake
  // waybill on a production order.
  if ((await activeKaEnv()) === "production") {
    return {
      ok: false,
      error: "Isi resi contoh hanya untuk demo/sandbox — tidak tersedia di produksi.",
    };
  }
  const demoAwb =
    "DEMO" +
    orderNumber
      .replace(/[^A-Za-z0-9]/g, "")
      .slice(-10)
      .toUpperCase();
  const res = await withTenant(storeId, async (db) => {
    const [row] = await db.select({ id: schema.orders.id, courier: schema.orders.courier }).from(schema.orders).where(eq(schema.orders.number, orderNumber)).limit(1);
    if (!row) return { ok: false as const, error: "Pesanan tidak ditemukan." };
    await db
      .update(schema.orders)
      .set({ awb: demoAwb, courier: row.courier ?? "spx" })
      .where(eq(schema.orders.id, row.id));
    return { ok: true as const };
  });
  if (!res.ok) return res;
  revalidatePath(`/pesanan/${orderNumber}`);
  return { ok: true, awb: demoAwb };
}
