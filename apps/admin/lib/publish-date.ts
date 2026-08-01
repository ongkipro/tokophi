// THE RULE: a publish date is stamped ONCE — when the row first goes live — and an edit never moves it.
//
// Extracted from `lib/actions/articles.ts` so it can be tested: that module is `"use server"`, where
// every export must be an async server action, so the rule cannot live there and still be asserted.
//
// ⚠️ It exists because `publishedAt` was written as a frozen `ADMIN_TODAY = 2026-06-30` (the seed's
// frame). `fields()` in the articles action is a FULL REPLACE, not a patch, so every Simpan re-wrote
// that constant over the real date: re-saving an already-published article walked its publish date
// BACKWARDS, further from the truth on each save, and the gap widened by a day every day. Identical
// in shape to the voucher-expiry bug (`ADMIN_TODAY` in `lib/actions/discounts.ts`), which made every
// voucher a merchant created born already expired. **The seed may be anchored; the app is not.**
export function publishedAtFor(published: boolean, current: Date | null, now: Date = new Date()): Date | null {
  if (!published) return null; // back to draft → no publish date; re-publishing stamps a fresh one
  return current ?? now; // already live → keep the row's own date; first publish → stamp it now
}
