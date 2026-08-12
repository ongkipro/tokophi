import { schema } from "@tokophi/db";
import { sql } from "drizzle-orm";
import type { Tx } from "@/lib/tenant";

export type PayoutResult = { ok: boolean; error?: string; payoutId?: string };

/** Check-and-book one payout while holding the store lock for the surrounding transaction. */
export async function requestPayoutInTenant(
  db: Tx,
  storeId: string,
  amount: number,
): Promise<PayoutResult> {
  const [settings] = (await db.execute(sql`
    select bank_name as "bankName", bank_account as "bankAccount", bank_holder as "bankHolder"
    from store_settings where store_id = ${storeId} limit 1
  `)) as unknown as {
    bankName: string | null;
    bankAccount: string | null;
    bankHolder: string | null;
  }[];

  if (!settings?.bankAccount || !settings?.bankName) {
    return {
      ok: false,
      error: "Lengkapi rekening bank dulu sebelum menarik saldo.",
    };
  }

  const [policy] = (await db.execute(sql`
    select min_payout_idr as "minPayout" from platform_payout limit 1
  `)) as unknown as { minPayout: string | number }[];
  const minPayout = Number(policy?.minPayout ?? 50_000);

  // The lock and balance read are one invariant: a concurrent request cannot approve against stale cash.
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtext(${storeId})::bigint)`,
  );
  const [bal] = (await db.execute(sql`
    select coalesce(sum(amount_idr), 0)::bigint as "available"
    from ledger_entries
    where store_id = ${storeId} and status = 'available'
  `)) as unknown as { available: string | number }[];
  const available = Number(bal?.available ?? 0);

  const want = Math.floor(amount);
  if (!Number.isFinite(want) || want <= 0)
    return { ok: false, error: "Jumlah tidak valid." };
  if (want < minPayout)
    return {
      ok: false,
      error: `Minimum penarikan Rp${minPayout.toLocaleString("id-ID")}.`,
    };
  if (want > available)
    return { ok: false, error: "Saldo tersedia tidak mencukupi." };

  const [payout] = await db
    .insert(schema.payouts)
    .values({
      storeId,
      amountIdr: want,
      status: "menunggu",
      bankName: settings.bankName,
      bankAccount: settings.bankAccount,
      bankHolder: settings.bankHolder,
    })
    .returning({ id: schema.payouts.id });

  await db.insert(schema.ledgerEntries).values({
    storeId,
    payoutId: payout.id,
    kind: "payout",
    status: "available",
    amountIdr: -want,
    note: "Penarikan saldo",
    availableAt: new Date(),
  });
  return { ok: true, payoutId: payout.id };
}
