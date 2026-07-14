// Shared courier roster — KiriminAja codes (must match the live `service` code from ongkir).
// Used by: super-admin (platform enable/disable + display order), client admin (merchant picks a
// subset of platform-enabled), storefront ongkir filter. NOT server-only (imported by client
// components).
//
// ⚠️ THIS IS A DISPLAY ROSTER — code → human name + sort order. It deliberately carries NO service
// list any more. It used to (`services: ["Reguler", "YES"]`), and that hand-written list was the
// single source of every shipping bug we have had:
//   · it gave SPX "Standard"/"Hemat" when the live service_types are "1" and "3" — the storefront
//     filter compared "Hemat" against "3" and silently matched nothing;
//   · the seed wrote those STRINGS into platform_couriers.services while the KiriminAja sync writes
//     OBJECTS, so the same jsonb column held two shapes at once (migration 0047 normalised it).
// The authoritative service catalogue is the API: kaServices() → platform_couriers.services. This
// file only supplies the human NAME and the display order; a code missing here still syncs and still
// renders (courierName falls back to the code) — it just sorts last.
//
// ⚠️ TIKI: an earlier version of this comment said "KiriminAja returns neither TIKI nor Pos" — HALF
// WRONG, and the half that was wrong cost us a courier. TIKI **is** carried; it simply does not serve
// the one reference route the roster used to be harvested from (Menteng → Coblong). Verified live
// 2026-07-14 across four routes: TIKI quotes on Menteng → Pleret, Gubeng → Menteng and Danurejan →
// Menteng. The union of those routes is 11 couriers / 23 services — the codes below. (Pos Indonesia
// really is absent from every route we have priced.) Never conclude "courier X does not exist" from
// a single route: see ROSTER_ROUTES in ./kiriminaja.ts.
/** Codes are compared case- and punctuation-insensitively ("J&T" / "jnt" / "JNT" are one courier). */
const normalizeCode = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export type CourierMeta = { code: string; name: string };

export const COURIERS: CourierMeta[] = [
  { code: "sicepat", name: "SiCepat" },
  { code: "jne", name: "JNE" },
  { code: "jnt", name: "J&T Express" },
  { code: "spx", name: "Shopee Express (SPX)" },
  { code: "anteraja", name: "AnterAja" },
  { code: "sap", name: "SAP Express" },
  { code: "lion", name: "Lion Parcel" },
  { code: "ninja", name: "Ninja Xpress" },
  { code: "idx", name: "ID Express" },
  { code: "tiki", name: "TIKI" },
  { code: "jtcargo", name: "J&T Cargo" },
];

export const COURIER_CODES = COURIERS.map((c) => c.code);
export const courierName = (code: string): string => COURIERS.find((c) => c.code === code)?.name ?? code;
export const courierMeta = (code: string): CourierMeta | undefined => COURIERS.find((c) => c.code === code);

// ─────────────────────────────────────────────────────────────────────────────
// WHAT THE SELLER MAY OFFER — a curated subset, not everything KiriminAja carries.
//
// The platform (super-admin) sees every courier the API returns; the seller sees only these. A
// merchant choosing between fourteen near-identical services is a merchant who chooses badly, and
// each extra courier is a support surface we take on. This list is a BUSINESS decision, so it lives
// here and not in a database toggle someone can widen by accident.
//
// Anything outside it — J&T Cargo, TIKI, and any courier KiriminAja onboards later — stays visible to
// the platform and invisible to sellers until it is added here deliberately.
// ─────────────────────────────────────────────────────────────────────────────
export const SELLER_COURIER_CODES = [
  "spx", "jne", "jnt", "lion", "sap", "sicepat", "idx", "anteraja",
];
export const isSellerCourier = (code: string | null | undefined): boolean =>
  !!code && SELLER_COURIER_CODES.includes(normalizeCode(code));

// SPX is the primary: it is the COD rail (our own gateway economics depend on it) and it is the only
// courier that quoted on every route we have measured. JNE is the backup — SPX first, JNE where SPX
// does not serve the route. Both are BASELINE: a seller cannot switch them off, because switching off
// the primary silently kills COD and switching off the backup leaves routes with no service at all.
export const BASELINE_COURIER_CODES = ["spx", "jne"];
export const isBaselineCourier = (code: string | null | undefined): boolean =>
  !!code && BASELINE_COURIER_CODES.includes(normalizeCode(code));

// …but the lock is on the REGULAR SERVICE, not on everything the baseline couriers sell. SPX Standard
// is the primary + the COD rail and JNE Reguler is the backup — those two must always be buyable. The
// rest of their catalogue (SPX Economy, the pricey JNE YES next-day) is the seller's own commercial
// choice and stays switchable. Locking a whole courier would have taken that choice away for no
// safety gain: nothing depends on JNE YES existing.
//
// service_type codes are KiriminAja's own (verified live 2026-07-14): SPX Standard = "1" (Economy is
// "3"), JNE Reguler = "REG23" (YES = "YES23").
export const BASELINE_SERVICES: { courier: string; type: string }[] = [
  { courier: "spx", type: "1" },
  { courier: "jne", type: "REG23" },
];
export const isBaselineService = (courier: string | null | undefined, type: string | null | undefined): boolean =>
  !!courier && !!type &&
  BASELINE_SERVICES.some((b) => b.courier === normalizeCode(courier) && b.type === String(type).trim());

/** Preference order the checkout's first quote walks: primary, then backup. */
export const PRIMARY_CHAIN = ["spx", "jne"];

// ⚠️ Availability is decided per PICKUP ORIGIN, not globally. Measured 2026-07-14: J&T quotes from
// Jakarta and Yogyakarta origins but NOT from Gubeng (Surabaya) — to any destination. So "enabled"
// never means "the shopper will see it"; a courier that does not collect from the seller's warehouse
// is simply absent. Surfaces must SAY that rather than show a green toggle that does nothing.

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

/** True for an on-demand/rider courier code (gosend, grab_express, borzo…) in any spelling. */
export const isInstantCourier = (code: string | null | undefined): boolean => {
  if (!code) return false;
  const c = normalizeCode(code);
  return INSTANT_COURIER_CODES.some((i) => c === i || c.startsWith(i));
};

/** True for a courier/service pair that is instant delivery — by courier code OR by service group. */
export const isInstantService = (s: { courier?: string | null; group?: string | null }): boolean =>
  isInstantCourier(s.courier) || (!!s.group && INSTANT_GROUPS.includes(normalizeCode(s.group)));
