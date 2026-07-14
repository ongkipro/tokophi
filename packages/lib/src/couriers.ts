// Shared courier roster — KiriminAja codes (must match the live `code` from ongkir).
// Used by: super-admin (platform enable/disable), client admin (merchant picks a subset of
// platform-enabled), storefront ongkir filter. NOT server-only (imported by client components).
export type CourierMeta = { code: string; name: string; services: string[] };

export const COURIERS: CourierMeta[] = [
  { code: "sicepat", name: "SiCepat", services: ["REG", "BEST"] },
  { code: "jne", name: "JNE", services: ["Reguler", "YES"] },
  { code: "jnt", name: "J&T Express", services: ["EZ"] },
  { code: "spx", name: "Shopee Express (SPX)", services: ["Standard", "Hemat"] },
  { code: "anteraja", name: "AnterAja", services: ["Reguler", "Same Day"] },
  { code: "sap", name: "SAP Express", services: ["Reguler"] },
  { code: "lion", name: "Lion Parcel", services: ["Regpack", "Bigpack"] },
  { code: "ninja", name: "Ninja Xpress", services: ["Standard"] },
  { code: "idx", name: "ID Express", services: ["Reguler"] },
  { code: "tiki", name: "TIKI", services: ["Reguler", "ONS"] },
  { code: "jtcargo", name: "J&T Cargo", services: ["Cargo"] },
  { code: "pos", name: "Pos Indonesia", services: ["Kilat Khusus"] },
];

export const COURIER_CODES = COURIERS.map((c) => c.code);
export const courierName = (code: string): string => COURIERS.find((c) => c.code === code)?.name ?? code;
export const courierMeta = (code: string): CourierMeta | undefined => COURIERS.find((c) => c.code === code);

// ─────────────────────────────────────────────────────────────────────────────
// Instant / on-demand couriers are OUT OF SCOPE (product decision, 2026-07).
//
// WHY: instant delivery (GoSend, GrabExpress, Borzo…) is too much to build for launch — TokoΦ ships
// via EXPEDITION couriers only (SPX, JNE, SiCepat, AnterAja, …). The instant client
// (kaInstantPricing / kaCreateInstantOrder, KiriminAja /api/mitra/v4/instant/*) has been deleted,
// along with the checkout option and the lat/lng the riders needed.
//
// This is the ONE place that answers "is this an instant courier/service?". The roster sync
// (super-admin), the seller's Jasa Kirim screen + shipment booking, and the storefront ongkir proxy
// all call it — so a future on-demand courier is handled by adding a CODE here, not by editing
// three files.
//
// It is a GUARD, not a fix: KiriminAja's express endpoint (/api/mitra/v6.1/shipping_price) does NOT
// return gosend/grab at all — they only exist behind the instant endpoints we removed. Verified
// against the sandbox on 2026-07-14 (reference route Menteng → Coblong, 20 services; couriers:
// sicepat, jtcargo, lion, anteraja, sap, spx, jne, jnt, ninja, idx; groups: regular, economy,
// next_day, one_day, cargo — no gosend, no grab, no borzo). The guard exists so that if KiriminAja
// ever folds an on-demand courier into the express roster, it still cannot reach a store.
//
// NOTE the boundary: `one_day` (AnterAja Same Day, SAP One Day Services) is an EXPEDITION service
// and STAYS. "Same day by expedition" is not "instant courier" — only rider-dispatch couriers are
// filtered.
// ─────────────────────────────────────────────────────────────────────────────
export const INSTANT_COURIER_CODES = [
  "gosend", "gojek", "grab", "grabexpress", "borzo", "mrspeedy", "lalamove", "deliveree",
];
/** Service groups KiriminAja uses for rider-dispatch delivery (its instant endpoints). */
export const INSTANT_GROUPS = ["instant", "ondemand"];

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** True for an on-demand/rider courier code (gosend, grab_express, borzo…) in any spelling. */
export const isInstantCourier = (code: string | null | undefined): boolean => {
  if (!code) return false;
  const c = normalize(code);
  return INSTANT_COURIER_CODES.some((i) => c === i || c.startsWith(i));
};

/** True for a courier/service pair that is instant delivery — by courier code OR by service group. */
export const isInstantService = (s: { courier?: string | null; group?: string | null }): boolean =>
  isInstantCourier(s.courier) || (!!s.group && INSTANT_GROUPS.includes(normalize(s.group)));
