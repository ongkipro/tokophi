// Client-safe health types + display meta (no server-only / no db imports) so both the
// server health computation (health.ts) and the client UI can share them.
export type CheckStatus = "ok" | "warn" | "fail";
export type HealthVerdict = "sehat" | "perhatian" | "bermasalah";
export type HealthCheck = { key: string; label: string; status: CheckStatus; detail: string };
export type StoreHealth = { verdict: HealthVerdict; score: number; checks: HealthCheck[] };

export const VERDICT_RANK: Record<HealthVerdict, number> = { sehat: 0, perhatian: 1, bermasalah: 2 };

export const verdictMeta: Record<HealthVerdict, { label: string; tone: "ok" | "warn" | "fail" }> = {
  sehat: { label: "Sehat", tone: "ok" },
  perhatian: { label: "Perhatian", tone: "warn" },
  bermasalah: { label: "Bermasalah", tone: "fail" },
};

export const checkToneClass: Record<CheckStatus, string> = {
  ok: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  fail: "text-red-600 dark:text-red-400",
};
