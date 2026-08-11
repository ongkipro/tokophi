import "server-only";
import { schema } from "@tokophi/db";
import { eq, asc, sql } from "drizzle-orm";
import { withCurrentTenant } from "@/lib/tenant";
import { shipmentPaymentState, shipmentPaymentLabel, type ShipmentPaymentState } from "@/lib/shipment-payment";
import { latestPaymentFirst } from "@/lib/data/order-payment";
import { weightForOrder } from "@/lib/shipping-weight";

// The real, per-order truth the detail page needs: line items straight out of `order_line_items`
// (joined to the variant + product for the variant title / image / emoji), the money columns the
// order itself carries, the shipment, the buyer, and the payment.
// Nothing here is derived from the order id — a value that does not exist in the DB comes back as
// `null` and the page renders an honest empty state.

export type OrderLine = {
  /** Snapshot title stored on the line item (what the buyer actually bought). */
  title: string;
  /** Variant title e.g. "Mustard / M" — null when the line has no variant row. */
  variant: string | null;
  qty: number;
  /** Unit price at the time of purchase (IDR). */
  price: number;
  /** Line total as stored (IDR) — NOT recomputed, so a bad row shows as a bad row. */
  total: number;
  /** Real product image (product_media, lowest position) — null when the product has none. */
  image: string | null;
  emoji: string | null;
};

export type OrderMoney = {
  /** orders.subtotal_idr */
  subtotal: number;
  discount: number;
  shipping: number;
  tax: number;
  /** True when PPN is already inside `subtotal` (inclusive) — then it must NOT be added to the total. */
  taxInclusive: boolean;
  /** orders.total_idr */
  total: number;
  /** Σ order_line_items.total_idr — shown next to `subtotal` when they disagree. */
  lineSum: number;
  /** subtotal - discount + shipping + tax; compared against `total`. */
  computedTotal: number;
  /** True when the stored total or subtotal does not reconcile with the real rows. */
  mismatch: boolean;
};

export type OrderShipment = {
  /** orders.courier — NULL unless a shipment was booked (KiriminAja). */
  courier: string | null;
  /** orders.service_type (0053) — the raw type code the shopper paid for. */
  serviceType: string | null;
  /**
   * Human service name ("SPX Standard") resolved from `platform_couriers.services` — the same
   * lateral lookup `bulk-shipping.ts` uses. NULL when the courier/service no longer resolves;
   * the label then falls back to the raw type code rather than printing nothing.
   */
  serviceName: string | null;
  /**
   * BILLABLE parcel weight in grams (`weightForOrder().billableGrams`, Σ variant weight ≥ 1 kg) —
   * the same number `createShipment` declares to the courier, so the label describes the booked
   * parcel, not a third weight.
   */
  weightGrams: number;
  /**
   * orders.awb — the COURIER's waybill. NULL until a courier actually issues one: KiriminAja's
   * request_pickup returns `awb: null` and only fills it once the pickup is accepted. It is never
   * back-filled with the booking reference, so a NULL here means "no scannable resi exists yet"
   * and the shipping label is correctly unprintable.
   */
  awb: string | null;
  /** orders.ka_order_id — the KiriminAja booking reference. Real, but NOT a waybill. */
  kaOrderId: string | null;
  /** orders.ka_pickup_number — the pickup number, which is also the courier's payment id (0088). */
  pickupNumber: string | null;
  /**
   * Who owes the COURIER for this parcel, and whether it is settled — the ONE separation between
   * the COD flow (the buyer pays the courier; nothing for us to settle) and the VA flow (we owe the
   * shipping cost, and **an unpaid booking never gets a waybill**, so the parcel silently does not
   * ship). Derived by `lib/shipment-payment.ts` from the order's own COD flag, never from the
   * vendor's fields alone. NULL courier booking ⇒ this is still computed and reads `unknown`.
   */
  payment: ShipmentPaymentState;
  /** The same state as merchant-facing Indonesian, formatted server-side. */
  paymentLabel: string;
  city: string | null;
  province: string | null;
  /**
   * The courier has flagged this parcel (`orders.problem_at`, migration 0062) — set by the tracking
   * poller on a `problem` outcome and CLEARED again the moment the parcel moves. NULL = no known
   * obstacle, which is also what an unmapped tracking status leaves it as: we only flag what the
   * courier actually told us.
   *
   * It is deliberately NOT a status. The order stays `dikirim` — the parcel really is out — so the
   * page renders this alongside the status badge, never instead of it.
   */
  problemAt: Date | null;
  problemAtLabel: string | null;
  /** The courier's reason in merchant-facing Indonesian, as written by the poller. */
  problemNote: string | null;
};

export type OrderBuyer = {
  name: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  province: string | null;
};

/**
 * WHERE THIS PARCEL GOES — the order's own address snapshot (`orders.ship_*`, migration 0042):
 * recipient, phone, street and kodepos frozen at checkout. This is what the label prints and what
 * `createShipment` books with.
 *
 * Only when an order predates the snapshot (no `ship_address`) does this fall back to the
 * CUSTOMER's saved address (`customer_addresses`) — which belongs to the person, not the
 * transaction, and moves when they move. `cityMatchesOrder` then says whether that fallback is even
 * plausible as this parcel's destination; the page warns when it is not. Null when neither exists —
 * the page then shows the order's city and says the street is not recorded. Never invented.
 */
export type OrderAddress = {
  recipient: string | null;
  phone: string | null;
  street: string | null;
  city: string | null;
  province: string | null;
  postcode: string | null;
  cityMatchesOrder: boolean;
};

export type OrderPaymentRecord = {
  /** payments.method (transfer|qris|ovo|gopay|dana|va|cod) */
  method: string;
  methodLabel: string;
  status: "menunggu" | "berhasil" | "gagal";
  paidAtLabel: string | null;
  amount: number;
  adminFee: number;
  /** payments.total when the gateway set it, else amount. */
  total: number;
  virtualAccount: string | null;
  channelCode: string | null;
};

/**
 * The seller's pickup identity (`store_settings.sender_*`) — what the LABEL prints in its
 * "Pengirim" box. NULL when the seller has not saved a pickup address; the label then shows the
 * store name alone, exactly as before.
 */
export type OrderSender = {
  phone: string | null;
  address: string | null;
  kecamatanName: string | null;
  postcode: string | null;
};

export type OrderDetail = {
  lines: OrderLine[];
  money: OrderMoney;
  shipment: OrderShipment;
  buyer: OrderBuyer | null;
  address: OrderAddress | null;
  payment: OrderPaymentRecord | null;
  sender: OrderSender | null;
};

const METHOD_LABEL: Record<string, string> = {
  transfer: "Transfer Bank",
  qris: "QRIS",
  ovo: "OVO",
  gopay: "GoPay",
  dana: "DANA",
  va: "Virtual Account",
  cod: "COD (Bayar di Tempat)",
};

const FMT = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "Asia/Jakarta",
});

export async function getOrderDetail(number: string): Promise<OrderDetail | null> {
  return withCurrentTenant(async (db, storeId) => {
    // Human service name for the label — same lateral lookup `bulk-shipping.ts` makes; NULL when
    // the courier/service no longer resolves (a platform-disabled courier must not hide the order).
    const serviceName = sql<string | null>`(
      select s->>'name' from platform_couriers pc
      cross join lateral jsonb_array_elements(pc.services) s
      where pc.courier = ${schema.orders.courier} and s->>'type' = ${schema.orders.serviceType}
      limit 1
    )`;
    const [o] = await db
      .select({
        id: schema.orders.id,
        customerId: schema.orders.customerId,
        serviceType: schema.orders.serviceType,
        serviceName,
        subtotal: schema.orders.subtotalIdr,
        discount: schema.orders.discountIdr,
        shipping: schema.orders.shippingIdr,
        tax: schema.orders.taxIdr,
        total: schema.orders.totalIdr,
        city: schema.orders.city,
        province: schema.orders.province,
        courier: schema.orders.courier,
        awb: schema.orders.awb,
        kaOrderId: schema.orders.kaOrderId,
        kaPickupNumber: schema.orders.kaPickupNumber,
        kaPaymentStatus: schema.orders.kaPaymentStatus,
        kaPaymentUrl: schema.orders.kaPaymentUrl,
        problemAt: schema.orders.problemAt,
        problemNote: schema.orders.problemNote,
        // Address SNAPSHOT (migration 0042) — the address this parcel was BOUGHT with.
        shipRecipient: schema.orders.shipRecipient,
        shipPhone: schema.orders.shipPhone,
        shipAddress: schema.orders.shipAddress,
        shipPostcode: schema.orders.shipPostcode,
      })
      .from(schema.orders)
      .where(eq(schema.orders.number, number))
      .limit(1);
    if (!o) return null;

    // Lowest-position image for the line's product (correlated so a product with no media → NULL).
    const image = sql<string | null>`(
      select m.url from ${schema.productMedia} m
      where m.product_id = ${schema.products.id}
      order by m.position asc limit 1
    )`;

    const lineRows = await db
      .select({
        title: schema.orderLineItems.title,
        variant: schema.productVariants.title,
        qty: schema.orderLineItems.qty,
        price: schema.orderLineItems.priceIdr,
        total: schema.orderLineItems.totalIdr,
        emoji: schema.products.emoji,
        image,
      })
      .from(schema.orderLineItems)
      .leftJoin(schema.productVariants, eq(schema.productVariants.id, schema.orderLineItems.variantId))
      .leftJoin(schema.products, eq(schema.products.id, schema.productVariants.productId))
      .where(eq(schema.orderLineItems.orderId, o.id))
      .orderBy(asc(schema.orderLineItems.id));

    const lines: OrderLine[] = lineRows.map((r) => ({
      title: r.title,
      variant: r.variant ?? null,
      qty: r.qty,
      price: r.price,
      total: r.total,
      image: r.image ?? null,
      emoji: r.emoji ?? null,
    }));

    const lineSum = lines.reduce((s, l) => s + l.total, 0);
    // Inclusive PPN is already INSIDE the subtotal (it does not add to the total); exclusive PPN adds
    // on top. There is no stored mode flag, so infer it from the numbers: if the total is explained
    // WITHOUT adding tax, the tax was inclusive. Otherwise the reconciliation double-counted it and
    // every inclusive order showed a false "tidak cocok" warning.
    const base = o.subtotal - o.discount + o.shipping;
    const taxInclusive = o.tax > 0 && base === o.total;
    const computedTotal = taxInclusive ? base : base + o.tax;
    const money: OrderMoney = {
      subtotal: o.subtotal,
      discount: o.discount,
      shipping: o.shipping,
      tax: o.tax,
      taxInclusive,
      total: o.total,
      lineSum,
      computedTotal,
      mismatch: lineSum !== o.subtotal || computedTotal !== o.total,
    };

    let buyer: OrderBuyer | null = null;
    // ── The parcel's address is the ORDER's, not the customer's ──────────────────────────────────
    // This used to read `customer_addresses` exclusively, and the comment above said "there is no
    // per-order address snapshot". There is: migration 0042 added ship_recipient/ship_phone/
    // ship_address/ship_postcode/ship_district_id, and 686 of 701 orders carry one. Reading the
    // CUSTOMER's row instead means a buyer who moved house silently moves every past parcel with
    // them — and this address is what gets PRINTED ON THE LABEL (order-detail.tsx → buildLabelHtml).
    // The snapshot is the address the shopper checked out with and the one createShipment books.
    let address: OrderAddress | null = o.shipAddress?.trim()
      ? {
          recipient: o.shipRecipient ?? null,
          phone: o.shipPhone ?? null,
          street: o.shipAddress,
          city: o.city ?? null,
          province: o.province ?? null,
          postcode: o.shipPostcode ?? null,
          // It IS the order's own address — it cannot disagree with the order's city.
          cityMatchesOrder: true,
        }
      : null;

    if (o.customerId) {
      const [c] = await db
        .select({
          name: schema.customers.name,
          email: schema.customers.email,
          phone: schema.customers.phone,
          city: schema.customers.city,
          province: schema.customers.province,
        })
        .from(schema.customers)
        .where(eq(schema.customers.id, o.customerId))
        .limit(1);
      if (c) {
        buyer = {
          name: c.name,
          email: c.email ?? null,
          phone: c.phone ?? null,
          city: c.city ?? null,
          province: c.province ?? null,
        };
      }
      const [a] = await db
        .select({
          address: schema.customerAddresses.address,
          city: schema.customerAddresses.city,
          province: schema.customerAddresses.province,
          postcode: schema.customerAddresses.postcode,
          recipient: schema.customerAddresses.recipient,
          phone: schema.customerAddresses.phone,
        })
        .from(schema.customerAddresses)
        .where(eq(schema.customerAddresses.customerId, o.customerId))
        .orderBy(asc(schema.customerAddresses.id))
        .limit(1);
      // FALLBACK ONLY — a pre-0042 order with no snapshot. Then, and only then, the customer's
      // saved address is the best guess available, and `cityMatchesOrder` tells the page how much
      // to trust it (the page shows an amber warning when it points at a different city).
      if (a && !address) {
        address = {
          recipient: a.recipient ?? null,
          phone: a.phone ?? null,
          street: a.address ?? null,
          city: a.city ?? null,
          province: a.province ?? null,
          postcode: a.postcode ?? null,
          // The order carries its own destination city; when the saved address points somewhere
          // else, this address is NOT this parcel's destination and the page must say so.
          cityMatchesOrder:
            !!a.city && !!o.city && a.city.trim().toLowerCase() === o.city.trim().toLowerCase(),
        };
      }
    }

    const [p] = await db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.orderId, o.id))
      // ⚠️ THE SAME ordering the LIST uses (`lib/data/orders.ts`), because it is now literally the
      // same expression: `latestPaymentFirst()` in `lib/data/order-payment.ts`. Most recently PAID
      // first, unpaid last, id as the tie-break — one order, one answer.
      //
      // This line used to read `desc(schema.payments.paidAt), desc(schema.payments.id)` and a comment
      // above it claimed it matched the list. It did not: drizzle's `desc()` emits a BARE `desc`, and
      // bare DESC in Postgres is NULLS FIRST, so this page ranked UNPAID payments first while the list
      // ranked them last. Measured: list `cod`, detail `va`, same order.
      .orderBy(latestPaymentFirst())
      .limit(1);

    const payment: OrderPaymentRecord | null = p
      ? {
          method: p.method,
          methodLabel: METHOD_LABEL[p.method] ?? p.method,
          status: p.status,
          paidAtLabel: p.paidAt ? FMT.format(p.paidAt) : null,
          amount: p.amountIdr,
          adminFee: p.adminFee ?? 0,
          total: p.total && p.total > 0 ? p.total : p.amountIdr,
          virtualAccount: p.virtualAccount ?? null,
          channelCode: p.channelCode ?? null,
        }
      : null;

    // Billable weight — the number the booking declares to the courier (label's "Isi" header).
    const pkg = await weightForOrder(db, o.id);

    // The seller's pickup identity, for the label's "Pengirim" box. `store_settings` is RLS-scoped,
    // but it is keyed by store_id — filter explicitly rather than trusting RLS blindly.
    const [ss] = await db
      .select({
        phone: schema.storeSettings.senderPhone,
        address: schema.storeSettings.senderAddress,
        kecamatanName: schema.storeSettings.senderKecamatanName,
        postcode: schema.storeSettings.senderPostcode,
      })
      .from(schema.storeSettings)
      .where(eq(schema.storeSettings.storeId, storeId))
      .limit(1);
    const sender: OrderSender | null = ss
      ? {
          phone: ss.phone?.trim() || null,
          address: ss.address?.trim() || null,
          kecamatanName: ss.kecamatanName?.trim() || null,
          postcode: ss.postcode?.trim() || null,
        }
      : null;

    // Separate the two COURIER money flows ONCE, here, so no render path has to reason about it.
    // Must sit AFTER `payment`: the COD flag comes from `payments.method` — the same expression
    // lib/cod.ts and the Pesanan tabs partition on — never from the vendor's own payment fields,
    // which the docs do not define for a COD package.
    const shipmentPayment: ShipmentPaymentState = shipmentPaymentState({
      isCod: payment?.method === "cod",
      kaPaymentStatus: o.kaPaymentStatus,
      kaPaymentUrl: o.kaPaymentUrl,
    });

    return {
      lines,
      money,
      shipment: {
        courier: o.courier ?? null,
        serviceType: o.serviceType ?? null,
        serviceName: o.serviceName ?? null,
        weightGrams: pkg.billableGrams,
        awb: o.awb ?? null,
        kaOrderId: o.kaOrderId ?? null,
        pickupNumber: o.kaPickupNumber ?? null,
        // The COD flag comes from `payments.method` — the same expression lib/cod.ts and the
        // Pesanan tabs partition on — never from the vendor's payment fields.
        payment: shipmentPayment,
        paymentLabel: shipmentPaymentLabel(shipmentPayment),
        city: o.city ?? null,
        province: o.province ?? null,
        problemAt: o.problemAt ?? null,
        // "macet sejak <tanggal>" — the age is the seller's actual question, so the label is
        // formatted here (server, id-ID, Asia/Jakarta) rather than in a render path.
        problemAtLabel: o.problemAt ? FMT.format(o.problemAt) : null,
        problemNote: o.problemNote ?? null,
      },
      buyer,
      address,
      payment,
      sender,
    };
  });
}
