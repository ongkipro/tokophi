import { sql, type SQL } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// REFUND TRANSITIONS — the decision is the UPDATE's own WHERE clause (Task 8.31; the shape of
// `payout-transition.ts`, for the reason it has: a read-then-check lets two operators both pass).
//
//   menunggu ──processRefund──▶ diproses ──markRefundPaid──▶ selesai
//        └────────────rejectRefund────────────┘──▶ gagal
//
// Nothing here touches the ledger: a refund is the BUYER's money, which never entered the seller's
// book (the sale was clawed back by `settleOrderLedger` when the order was cancelled). Paying it out
// settles an obligation the row already records; there is nothing to post.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

export type RefundStatus = "menunggu" | "diproses" | "selesai" | "gagal";

export type RefundConflict =
  | "tidak_ditemukan"
  | "belum_diproses" // still `menunggu` — mark-paid needs `diproses` first
  | "sudah_diproses" // `diproses` — process pressed twice
  | "sudah_lunas" // `selesai` — repeat clicks land here, and change nothing
  | "sudah_ditolak"; // `gagal`

export type RefundResult =
  | { ok: true; storeId: string; orderId: string; amount: number }
  | { ok: false; conflict: RefundConflict; from: RefundStatus | null; error: string };

const REFUSAL: Record<RefundConflict, string> = {
  tidak_ditemukan: "Pengembalian dana tidak ditemukan.",
  belum_diproses: "Pengembalian ini masih Menunggu — klik Proses dulu (transfer dimulai), baru tandai selesai.",
  sudah_diproses: "Pengembalian ini sudah diproses.",
  sudah_lunas: "Pengembalian dana sudah selesai.",
  sudah_ditolak: "Pengembalian dana sudah ditolak.",
};

export type RefundDb = { execute: (query: SQL) => Promise<unknown> };
const rows = async <T>(db: RefundDb, query: SQL): Promise<T[]> => (await db.execute(query)) as unknown as T[];

type Claimed = { storeId: string; orderId: string; amount: string | number };

async function explain(db: RefundDb, refundId: string, map: Partial<Record<RefundStatus, RefundConflict>>): Promise<RefundResult> {
  // For the MESSAGE only — the decision above was the UPDATE. Turning this read back into the
  // decision restores the race.
  const [row] = await rows<{ status: RefundStatus }>(db, sql`select status from refunds where id = ${refundId} for update`);
  if (!row) return { ok: false, conflict: "tidak_ditemukan", from: null, error: REFUSAL.tidak_ditemukan };
  const conflict = map[row.status] ?? "tidak_ditemukan";
  return { ok: false, conflict, from: row.status, error: REFUSAL[conflict] };
}

const won = (c: Claimed): RefundResult => ({ ok: true, storeId: c.storeId, orderId: c.orderId, amount: Number(c.amount) });

/** menunggu → diproses: an operator has started the transfer. */
export async function processRefundInTxn(db: RefundDb, refundId: string): Promise<RefundResult> {
  const [claimed] = await rows<Claimed>(
    db,
    sql`update refunds set status = 'diproses'
         where id = ${refundId} and status = 'menunggu'
        returning store_id as "storeId", order_id as "orderId", amount_idr as "amount"`,
  );
  if (claimed) return won(claimed);
  return explain(db, refundId, { diproses: "sudah_diproses", selesai: "sudah_lunas", gagal: "sudah_ditolak" });
}

/** diproses → selesai: the money left our account. `ref` is the bank-transfer reference. */
export async function markRefundPaidInTxn(db: RefundDb, refundId: string, ref?: string | null): Promise<RefundResult> {
  const [claimed] = await rows<Claimed>(
    db,
    sql`update refunds set status = 'selesai', paid_at = now(), note = coalesce(${ref ?? null}, note)
         where id = ${refundId} and status = 'diproses'
        returning store_id as "storeId", order_id as "orderId", amount_idr as "amount"`,
  );
  if (claimed) return won(claimed);
  return explain(db, refundId, { menunggu: "belum_diproses", selesai: "sudah_lunas", gagal: "sudah_ditolak" });
}

/** menunggu|diproses → gagal: refused, with a reason the buyer-facing screen shows. */
export async function rejectRefundInTxn(db: RefundDb, refundId: string, reason: string): Promise<RefundResult> {
  const [claimed] = await rows<Claimed>(
    db,
    sql`update refunds set status = 'gagal', note = ${reason}
         where id = ${refundId} and status in ('menunggu', 'diproses')
        returning store_id as "storeId", order_id as "orderId", amount_idr as "amount"`,
  );
  if (claimed) return won(claimed);
  return explain(db, refundId, { selesai: "sudah_lunas", gagal: "sudah_ditolak" });
}
