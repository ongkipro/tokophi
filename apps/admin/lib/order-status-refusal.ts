// The REFUSALS of the order state machine, and the Indonesian sentence each one owes the merchant.
//
// This is a PURE module — no `@tokophi/db` import — for the same reason `platform-rank.ts` is split
// from `platform-auth.ts`: `order-status.ts` pulls the schema at module scope, so a client component
// cannot import from it, and the three screens that call `setOrderStatus` are all `"use client"`.
// Splitting the vocabulary out is what lets the button and the state machine agree on one wording.
//
// ⚠️ WHY THIS EXISTS AT ALL: `applyOrderStatusChange` has always returned `{applied, reason}`, and
// the two BACKGROUND callers (the KiriminAja tracking poller, the order-expiry cron) have always
// read it. The merchant's own path threw it away — `setOrderStatus` was `Promise<void>` — so all
// three screens reported success unconditionally. The expensive one is the return dialog:
// "Pesanan ditandai retur — stok dikembalikan." over an UPDATE that matched nothing. The order can
// reach a terminal state from the background between the page render and the click, which is
// exactly when the refusal fires, and the merchant then reconciles the warehouse from a sentence
// that is false. Same rule as `markLabelsPrinted`: report what you WROTE.

export type OrderStatusRefusal =
  | "order-not-found"
  | "status-unchanged"
  | "terminal-order"
  | "transition-not-allowed";

// A `Record` rather than a `switch`: adding a refusal to the union above fails `tsc` here until
// somebody writes the merchant's sentence for it, instead of falling into a default that says
// nothing useful.
const MESSAGE: Record<OrderStatusRefusal, string> = {
  // RLS filters another store's order out of the lookup, so "not found" also covers "not yours".
  "order-not-found": "Pesanan tidak ditemukan — mungkin sudah dihapus. Muat ulang halaman.",
  // Not an error: somebody else (another tab, the tracking poller) already made this exact change.
  "status-unchanged": "Status pesanan sudah seperti itu — tidak ada yang diubah.",
  "terminal-order":
    "Pesanan ini sudah dibatalkan atau diretur, jadi statusnya tidak bisa diubah lagi. Muat ulang halaman untuk melihat status terbarunya.",
  "transition-not-allowed":
    "Perubahan status itu tidak diizinkan dari status pesanan saat ini. Muat ulang halaman untuk melihat status terbarunya.",
};

export function orderStatusRefusalMessage(reason: OrderStatusRefusal): string {
  return MESSAGE[reason];
}
