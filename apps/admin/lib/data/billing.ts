import "server-only";
import { db, schema } from "@tokophi/db";
import { desc, eq } from "drizzle-orm";
import { computeBilling, type BillingState } from "@tokophi/lib/billing";
import { withCurrentTenant, type Tx } from "@/lib/tenant";
import { getSession } from "@/lib/auth";

// Current store's subscription state (trial/active/past_due/suspended + countdown + next amount).
export async function getBilling(): Promise<BillingState | null> {
  return withCurrentTenant(async (db: Tx, storeId) => {
    const [s] = await db
      .select({
        trialEndsAt: schema.stores.trialEndsAt,
        currentPeriodEnd: schema.stores.currentPeriodEnd,
        firstInvoicePaid: schema.stores.firstInvoicePaid,
        comped: schema.stores.comped,
      })
      .from(schema.stores)
      // Explicit, because RLS does NOT police `stores` (no store_id column, relrowsecurity = false).
      // Without this, `limit(1)` returned an arbitrary row: Batik Nusantara's owner was shown Kopi
      // Senja's subscription countdown (11 hari instead of 18), and the past_due/suspended banner
      // would have fired on a stranger's account. See lib/tenant.ts.
      .where(eq(schema.stores.id, storeId))
      .limit(1);
    return s ? computeBilling(s) : null;
  });
}

// The store's own subscription invoices (payment history). Read on the owner connection but
// scoped explicitly to the session's store — a merchant only ever sees their own.
export type MyInvoice = {
  number: string; amount: number; status: "dibayar" | "menunggu" | "gagal";
  cycle: string | null; kind: string | null; issuedAt: Date; paidAt: Date | null; virtualAccount: string | null;
};
export async function getMyInvoices(): Promise<MyInvoice[]> {
  const session = await getSession();
  if (!session) return [];
  const rows = await db
    .select({
      number: schema.invoices.number, amount: schema.invoices.amountIdr, status: schema.invoices.status,
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
      number: schema.invoices.number, amount: schema.invoices.amountIdr, status: schema.invoices.status,
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
