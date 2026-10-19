// Every number the sales page prints, read from the module that ENFORCES it — never retyped.
// A price or fee quoted on tokophi.com that drifts from what checkout/billing charges is a false
// advertisement, so the page imports the same constants the money paths use (DESIGN.md "Claim
// sources"). The landing is static: these are resolved at build time.
import { BILLING } from "@tokophi/lib/billing";
import { COURIERS } from "@tokophi/lib/couriers";
import { IDR } from "@tokophi/lib/format";
import { COD_FEE_MIN_IDR, COD_FEE_RATE } from "@tokophi/lib/order-finance";
import { CHANNEL_FEE_OVERRIDES, PAYMENT_FEES } from "@tokophi/lib/payment-fees";

const pct = (rate: number) => `${(rate * 100).toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`;

export const PRICE = {
  trialDays: BILLING.TRIAL_DAYS,
  firstMonth: IDR(BILLING.FIRST_MONTH_IDR),
  monthly: IDR(BILLING.MONTHLY_IDR),
  annual: IDR(BILLING.ANNUAL_IDR),
  annualPerMonth: IDR(BILLING.ANNUAL_MONTHLY_IDR),
  // Saving of a year paid annually against twelve regular months.
  annualSaving: IDR(BILLING.MONTHLY_IDR * 12 - BILLING.ANNUAL_IDR),
  graceDays: BILLING.GRACE_DAYS,
} as const;

// Payment methods LIVE on production (BUILD-LOG 2026-09-23). E-wallet and minimarket exist in
// `PAYMENT_FEES` but are switched off at the platform, so they are deliberately not listed here.
export const VA_BANKS = ["BCA", "BNI", "BRI", "Mandiri", "Permata"] as const;

export const FEES = {
  qris: `${pct(PAYMENT_FEES.qris.value)} dari nilai barang`,
  va: `${IDR(PAYMENT_FEES.va.value)} per transaksi (BCA ${IDR(CHANNEL_FEE_OVERRIDES.VABCA)})`,
  cod: `${pct(COD_FEE_RATE)} dari nilai barang + ongkir (min. ${IDR(COD_FEE_MIN_IDR)}), ditambah PPN 11% atas biaya itu`,
} as const;

// Production policy row (Super Admin → payout policy), shown on the Seller's /saldo screen
// ("Minimum Rp 200.000", captured 2026-10-11). Not a code constant: the code default is Rp50.000.
export const MIN_PAYOUT = IDR(200_000);

// COD gates (apps/admin/lib/cod.ts + platform_cod row): SPX only, six provinces, order cap.
export const COD = {
  courier: "SPX",
  provinces: ["DKI Jakarta", "Jawa Barat", "Banten", "Jawa Tengah", "DI Yogyakarta", "Jawa Timur"],
  cap: IDR(2_000_000),
} as const;

export const COURIER_NAMES = COURIERS.map((c) => c.name);
export const COURIER_COUNT = COURIERS.length;
