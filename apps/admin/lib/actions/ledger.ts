"use server";
import { schema } from "@tokophi/db";
import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { requireCapability } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";
import {
  getExportRows,
  getInvoiceDetail,
  type CsvRow,
  type InvoiceDetail,
  type LedgerFilters,
  type SaldoTab,
} from "@/lib/data/ledger";

/**
 * Tarik saldo (request a payout).
 *
 * This is the one irreversible action in the product: money leaves. Everything here is written
 * defensively.
 *
 * Concurrent withdrawals are serialised per store — see the note at the lock below, which explains
 * both the race and the `FOR UPDATE … sum()` bug that used to make every withdrawal throw.
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

    // ── Serialise concurrent withdrawals for THIS store ──────────────────────
    //
    // The race is real: two "Tarik" clicks landing together could each read the same balance, each
    // pass the "do you have enough?" test, and the merchant walks away with twice their money.
    // Checking and then writing is not enough — the check has to HOLD until the write lands.
    //
    // A transaction-scoped ADVISORY lock keyed on the store does exactly that: the second request
    // blocks here until this transaction commits, and only then reads a balance that already
    // includes this payout's negative entry. It is released automatically on commit or rollback.
    //
    // NOT `FOR UPDATE`, for two reasons:
    //   1. `select sum(amount_idr) … for update` is what this originally said, and Postgres rejects
    //      it outright — "FOR UPDATE is not allowed with aggregate functions". EVERY withdrawal
    //      threw. The guard against losing money was itself the thing that broke the feature.
    //   2. Even written legally, row-locking the ledger locks a table that grows forever, so each
    //      withdrawal would be slower than the last. The advisory lock is one key, regardless of size.
    //
    // `tsc` cannot see inside a SQL string, so nothing caught this until a payout was actually
    // attempted. Money paths must be EXERCISED, not typechecked.
    await db.execute(sql`select pg_advisory_xact_lock(hashtext(${storeId})::bigint)`);

    const [bal] = (await db.execute(sql`
      select coalesce(sum(amount_idr), 0)::bigint as "available"
      from ledger_entries
      where store_id = ${storeId} and status = 'available'
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
  // `allowSuspended`: this moves no money. Blocking it only stopped a suspended merchant from FIXING
  // where their own money would go — while the read actions a few lines up deliberately stay open,
  // with the comment "a suspended merchant is entitled to look at their own money … that is precisely
  // when they need it". Being able to see the balance and not correct the account it pays into is the
  // same principle applied halfway. (Whether `requestPayout` should also open up is a business
  // decision about withholding settled sales revenue over a subscription debt — recorded in
  // BACKLOG.md, deliberately not taken here.)
  const { storeId } = await requireCapability("settings:write", { allowSuspended: true });
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

/* ── Read actions ────────────────────────────────────────────────────────────
   Two things on this page cannot be prefetched with the server component: the invoice a merchant
   *chooses* to open, and the export they *choose* to download. Both are on-demand, so they go
   through a server action rather than bloating every page load.

   They are still reads: they must NOT go through `requireCapability`, which additionally blocks a
   suspended store from *writing*. A suspended merchant is entitled to look at their own money and
   export their own history — that is precisely when they need it. The session check below is the
   real boundary; the data layer's `withCurrentTenant` re-derives the store from the same session
   and RLS clamps the rows to it, so a forged orderId from another tenant returns nothing.
   ──────────────────────────────────────────────────────────────────────────── */

async function requireSession() {
  const session = await getSession();
  if (!session) throw new Error("Sesi berakhir — silakan masuk kembali.");
  return session;
}

/** The order behind a "dana dalam proses" row: buyer, address, phone, and the variants in the box. */
export async function fetchInvoiceDetail(orderId: string): Promise<InvoiceDetail | null> {
  await requireSession();
  return getInvoiceDetail(orderId);
}

/** Every row matching the CURRENT filters — not just the page on screen. */
export async function fetchExportRows(tab: SaldoTab, filters: LedgerFilters): Promise<CsvRow[]> {
  await requireSession();
  return getExportRows(tab, filters);
}
