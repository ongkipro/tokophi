// ─────────────────────────────────────────────────────────────────────────────────────────────
// The ONE place that answers "who pays the courier for THIS parcel, and is it settled?"
//
// A KiriminAja booking carries two money flows down one call, and they run in OPPOSITE directions:
//
//   NON-COD  we → KiriminAja.  `payment_method` defaults to `va`, so the booking comes back with
//            `payment_status` (unpaid | pending | paid) and a `qr_url` while it is unpaid. **An
//            unpaid booking never ships** — no waybill is issued, so the poller finds nothing, the
//            resi never appears, and the order sits at "dibooking" looking perfectly healthy. That
//            is the failure this module exists to make visible.
//
//   COD      buyer → KiriminAja → merchant. The vendor documents that `payment_method` is IGNORED
//            for COD packages ("the system will automatically use the COD settlement scheme"), and
//            rejects the combination outright with code 4003. There is NO va for us to settle, so
//            an "unpaid" reading on a COD order is noise, not a debt.
//
// Which flow an order is on is decided by the ORDER's own COD flag — `payments.method = 'cod'`, the
// same expression `lib/cod.ts` and the Pesanan tabs partition on — never by re-reading the vendor's
// payment fields. The vendor does not document what `payment_status` holds for a COD package, and
// guessing there would put a false "belum dibayar" warning on parcels nobody owes anything for.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** What the courier booking is waiting on. One of these, never a free-text status. */
export type ShipmentPaymentState =
  /** COD: the buyer pays the courier on delivery; nothing for us to settle. */
  | { flow: "cod"; settled: true; blocking: false }
  /** Non-COD, KiriminAja confirms it has the money. The parcel can move. */
  | { flow: "va"; settled: true; blocking: false }
  /** Non-COD, awaiting confirmation. Not yet a problem — VA/QRIS confirmation is not instant. */
  | { flow: "va"; settled: false; blocking: false; payUrl: string | null }
  /** Non-COD and UNPAID. ⚠️ This parcel will not ship until it is settled. */
  | { flow: "va"; settled: false; blocking: true; payUrl: string | null }
  /** We have no reading — a booking made before 0087, or a vendor response without the field. */
  | { flow: "unknown"; settled: false; blocking: false };

export type ShipmentPaymentInput = {
  /** From the ORDER (payments.method = 'cod'), never from the vendor's payment fields. */
  isCod: boolean;
  /** `orders.ka_payment_status` — the vendor's `payment_status`, verbatim. */
  kaPaymentStatus: string | null | undefined;
  /** `orders.ka_payment_url` — the vendor's `qr_url`. */
  kaPaymentUrl?: string | null;
};

/**
 * Separate the COD flow from the VA flow and say whether the courier is waiting to be paid.
 *
 * Pure. The caller decides what to render; this decides what is true.
 */
export function shipmentPaymentState(i: ShipmentPaymentInput): ShipmentPaymentState {
  // COD FIRST, and unconditionally. A COD order is settled by definition of the scheme — whatever
  // the vendor put in `payment_status` for it, we owe nothing, so it must never raise a warning.
  if (i.isCod) return { flow: "cod", settled: true, blocking: false };

  const raw = i.kaPaymentStatus?.trim().toLowerCase();
  if (!raw) return { flow: "unknown", settled: false, blocking: false };

  const payUrl = i.kaPaymentUrl?.trim() || null;
  if (raw === "paid") return { flow: "va", settled: true, blocking: false };
  // `pending` is a payment in flight — VA and QRIS confirmation is not instant, and shouting at a
  // merchant who paid thirty seconds ago trains them to ignore the warning that matters.
  if (raw === "pending") return { flow: "va", settled: false, blocking: false, payUrl };
  if (raw === "unpaid") return { flow: "va", settled: false, blocking: true, payUrl };
  // A status the vendor added since these docs were captured. `unknown` changes nothing and warns
  // about nothing — the same discipline as an unmapped tracking code (see ka-tracking.ts).
  return { flow: "unknown", settled: false, blocking: false };
}

/** Merchant-facing Indonesian. Provider brands stay hidden from clients (ADR 0004). */
export function shipmentPaymentLabel(s: ShipmentPaymentState): string {
  switch (s.flow) {
    case "cod":
      return "Ongkir ditagih ke pembeli (COD)";
    case "va":
      if (s.settled) return "Ongkir pengiriman sudah dibayar";
      return s.blocking ? "Ongkir pengiriman BELUM dibayar" : "Pembayaran ongkir sedang diproses";
    case "unknown":
      return "Status pembayaran ongkir tidak diketahui";
  }
}
