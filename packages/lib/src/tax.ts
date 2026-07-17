// Merchant storefront PPN — distinct from the PLATFORM billing PPN in billing.ts (that one is a fixed
// 11% on subscription invoices). This is the tax a merchant optionally charges on their own sales, at
// a rate they configure. Given the goods subtotal and the store's tax settings, it returns the tax to
// record on the order (orders.tax_idr) and how much that adds to the amount charged.
//
// Used by BOTH the order API (the authoritative money) and the checkout display, so the number the
// shopper sees is the number they pay — keep it the single source of this math.

export type TaxSettings = { enabled: boolean; ratePct: number; inclusive: boolean };
export type TaxResult = { taxIdr: number; addToTotal: number };

export function computeTax(subtotalIdr: number, s: TaxSettings): TaxResult {
  if (!s.enabled || s.ratePct <= 0 || subtotalIdr <= 0) return { taxIdr: 0, addToTotal: 0 };
  const r = s.ratePct / 100;
  if (s.inclusive) {
    // Prices already include PPN: break out the tax portion for the faktur; the total is unchanged.
    const base = Math.round(subtotalIdr / (1 + r));
    return { taxIdr: subtotalIdr - base, addToTotal: 0 };
  }
  // Exclusive (the common case): PPN is added on top of the subtotal.
  const taxIdr = Math.round(subtotalIdr * r);
  return { taxIdr, addToTotal: taxIdr };
}
