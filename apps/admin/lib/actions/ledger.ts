"use server";
import { schema } from "@tokophi/db";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { requireCapability } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";
import { requestPayoutInTenant } from "@/lib/payout";
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
  const result = await withTenant(storeId, (db) => requestPayoutInTenant(db, storeId, amount));
  if (result.ok) revalidatePath("/saldo");
  return result;
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
