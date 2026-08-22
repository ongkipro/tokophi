import { sql, type SQL } from "drizzle-orm";

/**
 * THE PAID TRANSITION OF A PAYOUT — `diproses → selesai`, AND NOTHING ELSE (Task 5.10 / F-M15).
 *
 * 🔴 WHAT THIS EXISTS TO FIX. `markPayoutPaid` read the row, refused `selesai` and `gagal`, and
 * updated everything that was left — so `menunggu → selesai` went straight through. That is the one
 * transition nobody ever performs on purpose: `menunggu` means the merchant has asked and **no
 * operator has started a bank transfer**, and `processPayout` is the click that records that they
 * did. Marking such a row LUNAS writes `paid_at`, tells the merchant on `/saldo` that their money
 * has been sent, and permanently closes the row — `processPayout` afterwards refuses, because the
 * status is no longer `menunggu`. The initiation step is not merely skipped, it becomes
 * unreachable, and the audit trail says a transfer happened that nobody made.
 *
 * WHY A COMPARE-AND-SWAP AND NOT A READ-THEN-CHECK. The legal source state is checked **in the
 * UPDATE's own WHERE**, exactly the way `applyDiscount` enforces its usage limit and the
 * impersonation exchange spends its grant: one statement decides and writes, so two operators
 * clicking "Tandai lunas" at the same instant cannot both pass a check and both write. One row back
 * ⇒ this call is the one that completed it. Zero rows ⇒ it was not `diproses` — unknown, still
 * waiting, already paid, or rejected — and NOTHING was written.
 *
 * ⚠️ The classification read below exists ONLY to name the state in the operator's message. It is
 * never the decision (that already happened, above it, in the UPDATE) — turning it back into the
 * decision restores the race this shape removes.
 *
 * NOTHING IS POSTED TO THE LEDGER HERE, and that is correct: the merchant's balance was debited
 * when they REQUESTED the payout (a negative `payout` entry), so paying it settles an obligation
 * already recorded. Every refusal path writes nothing at all, so a refused attempt cannot move a
 * rupiah either — which is what makes a repeated "Tandai lunas" non-mutating rather than merely
 * harmless-looking.
 *
 * It lives OUTSIDE `actions.ts` for the same reason `apps/admin/lib/payout.ts` and
 * `ledger-credit.ts` do: `actions.ts` is `"use server"` and pulls `@tokophi/db`, `next/cache` and
 * the session at module scope, so nothing in it can be driven against a real database. This module
 * imports no client and no schema — only `sql` — so `payout-transition.test.ts` can run the real
 * statements against real Postgres for every source status.
 */

/** `payout_status` (migration 0000). The four states a `payouts` row can be in. */
export type PayoutStatus = "menunggu" | "diproses" | "selesai" | "gagal";

/**
 * Why the paid transition was refused. A CODE, not only a sentence: a caller that must branch on
 * "was it already paid?" cannot do it by matching Indonesian prose, and the test names the state it
 * attempted rather than the message it happened to get.
 */
export type PayoutConflict =
  | "tidak_ditemukan" // no such payout
  | "belum_diproses" // still `menunggu` — THE DEFECT: this used to be allowed
  | "sudah_lunas" // already `selesai` — repeat clicks land here, and change nothing
  | "sudah_ditolak"; // `gagal` — the money was already returned to the merchant

export type MarkPaidResult =
  | { ok: true; storeId: string; amount: number }
  | { ok: false; conflict: PayoutConflict; from: PayoutStatus | null; error: string };

/** The one message per conflict, so the action and any future caller cannot drift apart. */
const REFUSAL: Record<PayoutConflict, string> = {
  tidak_ditemukan: "Pencairan tidak ditemukan.",
  belum_diproses:
    "Pencairan ini masih Menunggu — klik Proses dulu (transfer bank dimulai), baru tandai lunas.",
  sudah_lunas: "Pencairan sudah lunas.",
  sudah_ditolak: "Pencairan sudah ditolak — dananya sudah dikembalikan.",
};

const CONFLICT_BY_STATUS: Record<PayoutStatus, PayoutConflict> = {
  menunggu: "belum_diproses",
  diproses: "belum_diproses", // unreachable via the CAS below; present so the map stays total
  selesai: "sudah_lunas",
  gagal: "sudah_ditolak",
};

/** The minimum surface this module needs — drizzle's `db` and a `tx` both satisfy it. */
export type PayoutDb = { execute: (query: SQL) => Promise<unknown> };

const rows = async <T>(db: PayoutDb, query: SQL): Promise<T[]> =>
  (await db.execute(query)) as unknown as T[];

/**
 * Claim one payout as paid. Legal source state: `diproses`, and only `diproses`.
 *
 * @returns `{ ok: true }` exactly once per payout — the call that performed the transition. Every
 *          other call, in every other state, returns a typed conflict and writes nothing.
 */
export async function markPayoutPaidInTxn(
  db: PayoutDb,
  payoutId: string,
): Promise<MarkPaidResult> {
  // The whole guard, in the statement that writes. `paid_at` is set here (not by the caller) so the
  // stamp and the state change are the same write and cannot disagree.
  const [claimed] = await rows<{ storeId: string; amount: string | number }>(
    db,
    sql`
      update payouts
         set status = 'selesai', paid_at = now()
       where id = ${payoutId} and status = 'diproses'
      returning store_id as "storeId", amount_idr as "amount"
    `,
  );
  // `RETURNING` proves the write happened — the caller's audit line therefore reports what was
  // WRITTEN, never what it was asked to write (the `markLabelsPrinted` rule).
  if (claimed) return { ok: true, storeId: claimed.storeId, amount: Number(claimed.amount) };

  // Nothing was written. Read the row — LOCKED, so the state we name cannot change while we name it
  // — purely to say WHICH refusal this is. A missing row is a refusal too, not a crash.
  const [row] = await rows<{ status: PayoutStatus }>(
    db,
    sql`select status from payouts where id = ${payoutId} for update`,
  );
  if (!row) return { ok: false, conflict: "tidak_ditemukan", from: null, error: REFUSAL.tidak_ditemukan };
  const conflict = CONFLICT_BY_STATUS[row.status] ?? "belum_diproses";
  return { ok: false, conflict, from: row.status, error: REFUSAL[conflict] };
}
