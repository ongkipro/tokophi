import "server-only";
import { schema } from "@tokophi/db";
import { eq, asc, desc, sql } from "drizzle-orm";
import { withCurrentTenant } from "@/lib/tenant";

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
  /** orders.awb — same. */
  awb: string | null;
  city: string | null;
  province: string | null;
};

export type OrderBuyer = {
  name: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  province: string | null;
};

/**
 * The customer's SAVED address (`customer_addresses`) — it belongs to the customer, not to this
 * order: an order carries only `orders.city` / `orders.province`, there is no per-order address
 * snapshot. So this is shown as "alamat pelanggan", and `cityMatchesOrder` tells the page whether
 * it is even plausible as this parcel's destination. Null when the customer has no address row —
 * in that case the page shows the order's city and says the street is not recorded. Never invented.
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

export type OrderDetail = {
  lines: OrderLine[];
  money: OrderMoney;
  shipment: OrderShipment;
  buyer: OrderBuyer | null;
  address: OrderAddress | null;
  payment: OrderPaymentRecord | null;
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
  return withCurrentTenant(async (db) => {
    const [o] = await db
      .select({
        id: schema.orders.id,
        customerId: schema.orders.customerId,
        subtotal: schema.orders.subtotalIdr,
        discount: schema.orders.discountIdr,
        shipping: schema.orders.shippingIdr,
        tax: schema.orders.taxIdr,
        total: schema.orders.totalIdr,
        city: schema.orders.city,
        province: schema.orders.province,
        courier: schema.orders.courier,
        awb: schema.orders.awb,
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
    const computedTotal = o.subtotal - o.discount + o.shipping + o.tax;
    const money: OrderMoney = {
      subtotal: o.subtotal,
      discount: o.discount,
      shipping: o.shipping,
      tax: o.tax,
      total: o.total,
      lineSum,
      computedTotal,
      mismatch: lineSum !== o.subtotal || computedTotal !== o.total,
    };

    let buyer: OrderBuyer | null = null;
    let address: OrderAddress | null = null;
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
      if (a) {
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
      .orderBy(desc(schema.payments.id))
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

    return {
      lines,
      money,
      shipment: {
        courier: o.courier ?? null,
        awb: o.awb ?? null,
        city: o.city ?? null,
        province: o.province ?? null,
      },
      buyer,
      address,
      payment,
    };
  });
}
