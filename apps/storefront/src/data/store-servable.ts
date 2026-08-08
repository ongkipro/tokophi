// SEC-1 — a store that is LOCKED must not have its catalogue served to the public.
//
// Pure on purpose: no db, no env, so the rule is testable without a database. Same reason
// `themeSourceStoreId` (T-9) and `servableVerdict` (DOM-3) were split out.
//
// `suspendedAt` is the ONE fact that locks a store (schema.ts:117). `status` cannot be used: the
// comment there is explicit that `status` is a denormalised cache the billing cron rewrites nightly,
// so an operator's decision written to `status` was reverted within 24 hours. Gate on `suspendedAt`.
//
// ⚠️ Two DIFFERENT reasons share this lock, and they must not be confused when copy is written:
//   · `approvedAt === null` → a self-serve signup awaiting first review. They have done nothing wrong,
//     and the schema comment (0090) is explicit that telling them "Toko ditangguhkan" would be a lie.
//   · `approvedAt !== null` → approved once, then suspended for cause.
// This module only answers "may the public see it?" — the same answer for both. The distinction is
// carried so a future holding page can say the right thing to each.

export type StoreLockState = { suspendedAt: Date | null; approvedAt: Date | null };

/** May the public be served this store's catalogue? */
export const isPubliclyServable = (s: StoreLockState): boolean => s.suspendedAt === null;

export type LockReason = "awaiting-first-review" | "suspended-for-cause" | null;

/** Why it is locked — for copy and for the operator, never for the access decision itself. */
export const lockReason = (s: StoreLockState): LockReason => {
  if (s.suspendedAt === null) return null;
  return s.approvedAt === null ? "awaiting-first-review" : "suspended-for-cause";
};
