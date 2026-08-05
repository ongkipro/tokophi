/**
 * Read a super-admin action's refusal — the CALLER half of N48.
 *
 * `platformGate` made every gated action ANSWER instead of throw. That is only half the fix: an
 * answer nobody reads is as silent as an exception nobody catches. Six call sites were awaiting an
 * action that used to return `void` and then toasting success unconditionally, so a refused operator
 * saw "Pengaturan pembayaran disimpan." over settings that were never written — worse than the
 * blank screen, because it is wrong rather than merely unhelpful.
 *
 * Kept as ONE reader rather than an `if (!r.ok)` at each site because the actions do not agree on
 * where the string lives: most carry `error`, but `testKiriminajaConnection`, `syncCouriersFrom-
 * Kiriminaja` and `testAutolarisConnection` report through `message` (their callers print one string
 * either way). A per-site check gets that wrong quietly — it reads `error`, finds `undefined`, and
 * shows an empty red toast.
 *
 * Client-safe on purpose: no `server-only`, no db import. `platform-auth.ts` cannot be imported from
 * a client component, and this has to be callable from the six that were ignoring the answer.
 */
export function refused(r: unknown): string | null {
  if (!r || typeof r !== "object" || !("ok" in r)) return null;
  const v = r as { ok?: unknown; error?: unknown; message?: unknown };
  if (v.ok !== false) return null;
  const said = typeof v.error === "string" ? v.error : typeof v.message === "string" ? v.message : "";
  // A refusal with no words renders as an empty red toast, which is the N48 bug one layer down.
  return said.trim() || "Tidak bisa dijalankan — coba muat ulang halaman.";
}
