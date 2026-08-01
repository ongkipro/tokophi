import { schema } from "@tokophi/db";
import { sql, type SQL } from "drizzle-orm";

/**
 * ONE definition of "the order's payment", for every screen that names a method.
 *
 * Most recently PAID first, unpaid last, `id` as the tie-break — so an order carrying an unpaid bill
 * beside a collected one always answers with the payment that actually happened.
 *
 * ⚠️ `nulls last` IS THE DEFINITION, not decoration. Postgres sorts `DESC` as **NULLS FIRST**, so a
 * bare `desc(payments.paidAt)` puts UNPAID rows at the top — the exact opposite. That is what this
 * pair did: `lib/data/orders.ts` (the list) wrote `paid_at desc nulls last` in raw SQL while
 * `lib/data/order-detail.ts` used drizzle's `desc()`, which emits a bare `desc`. Measured on real
 * Postgres against one order with a `menunggu` VA row and a collected `cod` row: **list → cod,
 * detail → va**. Both files carried a comment claiming they matched, and `#117` was recorded as
 * having unified them — so the mismatch was invisible to anyone reading either side.
 *
 * WHAT IT ACTUALLY COSTS: the merchant reads a DIFFERENT payment method on the Pesanan list than on
 * the order's own detail page — two screens, one order, two answers, and no way to tell which is
 * right. It does NOT reach the courier's cash-collection instruction: `createShipment` derives that
 * from `exists (select 1 from payments p where p.order_id = … and p.method = 'cod')`
 * (`lib/actions/shipping.ts`), an existence test no ORDER BY can move. Do not restate this bug as a
 * money bug — it is a "the screens disagree" bug, which is bad enough on its own.
 *
 * A function, not a constant, so each query gets a fresh `SQL` node. The columns are rendered
 * qualified (`"payments"."paid_at"`), so a correlated subquery using this must select
 * `from payments` **unaliased** — an alias would break the reference rather than silently reorder,
 * which is the failure mode we want.
 */
export const latestPaymentFirst = (): SQL =>
  sql`${schema.payments.paidAt} desc nulls last, ${schema.payments.id} desc`;
