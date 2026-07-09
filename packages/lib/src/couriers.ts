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
