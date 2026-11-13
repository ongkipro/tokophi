import "server-only";
import { db, schema } from "@tokophi/db";
import { desc, eq } from "drizzle-orm";
import { computeBilling, type BillingState } from "@tokophi/lib/billing";
import { owedCodeDiscount, type OwedCodeDiscount } from "@tokophi/db/subscription-invoice";
import { withCurrentTenant, type Tx } from "@/lib/tenant";
import { getSession } from "@/lib/auth";

// Current store's subscription state (trial/active/past_due/suspended + countdown + next amount).
export async function getBilling(): Promise<BillingState | null> {
  const row = await withCurrentTenant(async (db: Tx, storeId) => {
    const [s] = await db
      .select({
        trialEndsAt: schema.stores.trialEndsAt,
        currentPeriodEnd: schema.stores.currentPeriodEnd,
        firstInvoicePaid: schema.stores.firstInvoicePaid,
        comped: schema.stores.comped,
        // The operator's own suspension (0086). This is THE read that locks the panel:
        // `requireCapability` refuses every write when `readOnly` is true, and `readOnly` is what
        // `computeBilling` sets from this column. Dropping it from this select silently unsuspends
        // every store on the platform — which is why `StoreBillingRow.suspendedAt` is not optional.
        suspendedAt: schema.stores.suspendedAt,
        suspendedReason: schema.stores.suspendedReason,
        // 0090 — without this the banner greets a brand-new merchant with "ditangguhkan oleh TokoΦ".
        // Optional on the row type, so omitting it here would compile and simply read as approved.
        approvedAt: schema.stores.approvedAt,
      })
      .from(schema.stores)
      // Explicit, because RLS does NOT police `stores` (no store_id column, relrowsecurity = false).
      // Without this, `limit(1)` returned an arbitrary row: Batik Nusantara's owner was shown Kopi
      // Senja's subscription countdown (11 hari instead of 18), and the past_due/suspended banner
      // would have fired on a stranger's account. See lib/tenant.ts.
      .where(eq(schema.stores.id, storeId))
      .limit(1);
    return s ? { ...s, storeId } : null;
  });
  if (!row) return null;
  // ADR 0020 — the next amount must be the amount the creator WILL bill, so a store that has never paid
  // has its signup-code discount resolved by the same function the creator calls. Only then: once a
  // store has paid (or is VIP) nothing is owed, and this read — on every admin request (layout, sidebar,
  // RBAC) — stays one query. Owner pool, explicit store filter (`signup_codes` has RLS with no policy).
  const codeDiscountIdr = !row.firstInvoicePaid && !row.comped ? (await owedCodeDiscount(row.storeId)).discountIdr : 0;
  return computeBilling({ ...row, codeDiscountIdr });
}

/** ADR 0020 — the discount owed on the next invoice, and the code it comes from (for the Langganan copy). */
export async function getOwedCodeDiscount(): Promise<OwedCodeDiscount> {
  const session = await getSession();
  if (!session) return { code: null, discountIdr: 0 };
  return owedCodeDiscount(session.storeId);
}

// The store's own subscription invoices (payment history). Read on the owner connection but
// scoped explicitly to the session's store — a merchant only ever sees their own.
export type MyInvoice = {
  number: string; amount: number; taxIdr: number; status: "dibayar" | "menunggu" | "gagal";
  /** ADR 0020 — signup-code discount (DPP) this invoice carries, and its code; stored at creation. */
  codeDiscountIdr: number; discountCode: string | null;
  cycle: string | null; kind: string | null; issuedAt: Date; paidAt: Date | null; virtualAccount: string | null;
};
export async function getMyInvoices(): Promise<MyInvoice[]> {
  const session = await getSession();
  if (!session) return [];
  const rows = await db
    .select({
      number: schema.invoices.number, amount: schema.invoices.amountIdr, taxIdr: schema.invoices.taxIdr, status: schema.invoices.status,
      codeDiscountIdr: schema.invoices.codeDiscountIdr, discountCode: schema.invoices.discountCode,
      cycle: schema.invoices.cycle, kind: schema.invoices.kind, issuedAt: schema.invoices.issuedAt,
      paidAt: schema.invoices.paidAt, virtualAccount: schema.invoices.virtualAccount,
    })
    .from(schema.invoices)
    .where(eq(schema.invoices.storeId, session.storeId))
    .orderBy(desc(schema.invoices.issuedAt));
  return rows;
}

// One invoice for the printable faktur — scoped to the session's store (ownership enforced).
export type FakturData = {
  invoice: MyInvoice;
  store: { name: string; city: string | null };
  owner: { name: string | null; email: string };
};
export async function getFaktur(number: string): Promise<FakturData | null> {
  const session = await getSession();
  if (!session) return null;
  const [inv] = await db
    .select({
      number: schema.invoices.number, amount: schema.invoices.amountIdr, taxIdr: schema.invoices.taxIdr, status: schema.invoices.status,
      codeDiscountIdr: schema.invoices.codeDiscountIdr, discountCode: schema.invoices.discountCode,
      cycle: schema.invoices.cycle, kind: schema.invoices.kind, issuedAt: schema.invoices.issuedAt,
      paidAt: schema.invoices.paidAt, virtualAccount: schema.invoices.virtualAccount, storeId: schema.invoices.storeId,
    })
    .from(schema.invoices)
    .where(eq(schema.invoices.number, number))
    .limit(1);
  if (!inv || inv.storeId !== session.storeId) return null; // only your own store's faktur
  const [store] = await db.select({ name: schema.stores.name, city: schema.stores.city }).from(schema.stores).where(eq(schema.stores.id, session.storeId)).limit(1);
  const [owner] = await db
    .select({ name: schema.users.name, email: schema.users.email })
    .from(schema.storeUsers)
    .innerJoin(schema.users, eq(schema.users.id, schema.storeUsers.userId))
    .where(eq(schema.storeUsers.storeId, session.storeId))
    .limit(1);
  return { invoice: inv, store: store ?? { name: "", city: null }, owner: owner ?? { name: null, email: session.email } };
}
