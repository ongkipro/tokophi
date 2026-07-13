/**
 * Client-safe half of the Saldo contract — the same split as lib/rbac-policy.ts vs lib/rbac.ts.
 *
 * `lib/data/ledger.ts` is `import "server-only"` (it reaches next/headers through lib/tenant →
 * lib/auth). A client component that imports a *value* from it — a page size, a label map — drags
 * that whole chain into the browser bundle and the build dies. Types are erased and can be imported
 * from anywhere; constants cannot. So the constants the UI needs live here, and the data layer
 * imports them from here rather than the other way round.
 */

/** 20 rows per page, decided once, in SQL and in the pager. */
export const PAGE_SIZE = 20;

export type SaldoTab = "mutasi" | "proses" | "penarikan";

/** The three states a seller actually thinks in. */
export type LedgerStatus = "semua" | "proses" | "belum" | "ditarik";

export const LEDGER_STATUS_LABEL: Record<LedgerStatus, string> = {
  semua: "Semua status",
  proses: "Dalam proses",
  belum: "Belum ditarik",
  ditarik: "Sudah ditarik",
};
