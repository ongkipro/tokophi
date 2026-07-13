import "server-only";
import { schema } from "@tokophi/db";
import { eq } from "drizzle-orm";
import { withCurrentTenant } from "@/lib/tenant";

// Return metadata for one order (migration 0039: orders.returned_at / orders.return_reason).
// Colocated with the route instead of `lib/data/orders.ts` so the flat `Order` shape the whole
// admin shares stays untouched — only the detail page needs this.
export type OrderReturn = {
  reason: string;
  /** Pre-formatted (Asia/Jakarta) on the server → the client renders a plain string, no locale drift. */
  returnedAtLabel: string;
};

const FMT = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "Asia/Jakarta",
});

export async function getOrderReturn(number: string): Promise<OrderReturn | null> {
  return withCurrentTenant(async (db) => {
    const [row] = await db
      .select({
        status: schema.orders.status,
        returnedAt: schema.orders.returnedAt,
        returnReason: schema.orders.returnReason,
      })
      .from(schema.orders)
      .where(eq(schema.orders.number, number))
      .limit(1);

    if (!row || row.status !== "retur") return null;
    return {
      reason: row.returnReason?.trim() || "Pembeli menolak paket",
      // `returned_at` is only NULL for a row flipped outside the app (direct SQL) — say so honestly.
      returnedAtLabel: row.returnedAt ? FMT.format(row.returnedAt) : "Waktu tidak tercatat",
    };
  });
}
