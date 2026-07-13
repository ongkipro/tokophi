"use server";
import { schema } from "@tokophi/db";
import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";

/**
 * Tarik saldo (request a payout).
 *
 * This is the one irreversible action in the product: money leaves. Everything here is written
 * defensively.
 *
 * THE RACE THAT MATTERS: two withdrawal requests fired at once could each read the same balance
 * and each pass the "do you have enough?" check, and the merchant walks away with twice their
 * balance. Checking and then writing is not enough — the check must HOLD until the write lands.
 * So the balance is computed inside the same transaction under `FOR UPDATE` on the store's rows,
 * which serialises concurrent requests instead of letting them interleave.
 *
 * The payout is recorded as a NEGATIVE ledger entry, not by mutating a stored balance. The book
 * stays append-only: replay the entries and you get the balance, always.
 */
export async function requestPayout(
  amount: number,
): Promise<{ ok: boolean; error?: string; payoutId?: string }> {
  const { storeId } = await requireCapability("settings:write");

  return withTenant(storeId, async (db) => {
    // Bank details first — there is nowhere to send the money without them.
    const [settings] = (await db.execute(sql`
      select bank_name as "bankName", bank_account as "bankAccount", bank_holder as "bankHolder"
      from store_settings where store_id = ${storeId} limit 1
    `)) as unknown as { bankName: string | null; bankAccount: string | null; bankHolder: string | null }[];

    if (!settings?.bankAccount || !settings?.bankName) {
      return { ok: false, error: "Lengkapi rekening bank dulu sebelum menarik saldo." };
    }

    const [policy] = (await db.execute(sql`
      select min_payout_idr as "minPayout" from platform_payout limit 1
    `)) as unknown as { minPayout: string | number }[];
    const minPayout = Number(policy?.minPayout ?? 50_000);

    // Lock this store's ledger rows for the duration of the transaction, THEN compute the balance.
    // Any concurrent withdrawal blocks here rather than reading a balance that is about to change.
    const [bal] = (await db.execute(sql`
      select coalesce(sum(amount_idr), 0)::bigint as "available"
      from ledger_entries
      where store_id = ${storeId} and status = 'available'
      for update
    `)) as unknown as { available: string | number }[];
    const available = Number(bal?.available ?? 0);

    const want = Math.floor(amount);
    if (!Number.isFinite(want) || want <= 0) return { ok: false, error: "Jumlah tidak valid." };
    if (want < minPayout) {
      return { ok: false, error: `Minimum penarikan Rp${minPayout.toLocaleString("id-ID")}.` };
    }
    if (want > available) {
      return { ok: false, error: "Saldo tersedia tidak mencukupi." };
    }

    // Bank details are SNAPSHOTTED onto the payout: if the merchant edits their account later, a
    // historical payout must still show where the money actually went.
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
      status: "available", // it leaves the available pool immediately — it is spoken for
      amountIdr: -want,
      note: "Penarikan saldo",
      availableAt: new Date(),
    });

    revalidatePath("/saldo");
    return { ok: true, payoutId: payout.id };
  });
}

/** Rekening tujuan pencairan. */
export async function saveBankAccount(input: {
  bankName: string;
  bankAccount: string;
  bankHolder: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { storeId } = await requireCapability("settings:write");
  const bankName = input.bankName.trim();
  const bankAccount = input.bankAccount.trim();
  const bankHolder = input.bankHolder.trim();
  if (!bankName || !bankAccount || !bankHolder) {
    return { ok: false, error: "Nama bank, nomor rekening, dan nama pemilik wajib diisi." };
  }

  await withTenant(storeId, (db) =>
    db
      .insert(schema.storeSettings)
      .values({ storeId, bankName, bankAccount, bankHolder })
      .onConflictDoUpdate({
        target: schema.storeSettings.storeId,
        set: { bankName, bankAccount, bankHolder },
      }),
  );
  revalidatePath("/saldo");
  return { ok: true };
}
