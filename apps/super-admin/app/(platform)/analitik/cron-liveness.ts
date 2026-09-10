import { timeAgo } from "@tokophi/lib/format";
import type { CronRunRow } from "@/lib/data";

// Re-exported so the test can name the row shape without importing the data layer (which pulls
// `@tokophi/db` at module scope, i.e. a live connection, into a test runner).
export type { CronRunRow };

// CRON LIVENESS — the read half. `cron_runs` (migration 0091) holds one upserted row per compose
// sidecar; this module turns a row into the verdict the Sistem card paints.
//
// PURE, and in its own file, for the reason `platform-rank.ts` is: the rule that decides whether the
// resi poller is dead is the rule worth testing, and `lib/data.ts` imports `@tokophi/db` at module
// scope so nothing in it can be imported by a test runner. `cron-liveness.test.ts` sits beside it.

/** The sidecars in `docker-compose.coolify.yml`, in the order the card lists them. */
export const CRON_JOBS: { job: string; label: string; what: string }[] = [
  // First, and named for what a merchant would notice: this is the loop whose absence produced
  // `awbFilled = 0` for a week with nothing on any screen to say so.
  { job: "tracking", label: "Resi otomatis", what: "mengisi resi & memajukan status pesanan" },
  { job: "domains", label: "Aktivasi domain", what: "memeriksa hostname & sertifikat SSL merchant" },
  { job: "tracking-events", label: "Pengiriman konversi", what: "mengirim Purchase ke channel iklan" },
  { job: "billing", label: "Tagihan langganan", what: "sinkron status toko & terbitkan tagihan" },
  // ⚠️ Missing from this card since the sidecar shipped — a cron nobody lists is a cron nobody
  // misses, which is the sentence the test below exists to enforce. Found 2026-09-11.
  { job: "order-expiry", label: "Kedaluwarsa pesanan", what: "membatalkan pesanan prabayar yang tidak dibayar & memulihkan stok" },
  // Observe-only: reads AutoLaris `advice` for every live bill and records the answer distribution.
  // It settles NOTHING (see the route) — the card shows that it is looking, not that money moved.
  { job: "payment-advice", label: "Rekonsiliasi pembayaran", what: "membaca status tagihan prabayar di gateway (hanya mengamati)" },
];

/**
 * No job is called dead inside ten minutes.
 *
 * The `tracking-events` sidecar wakes every 60 s, so a bare 2× would call it dead after two minutes —
 * but its own endpoint budgets `BATCH × the per-call timeout ≈ 8 minutes` for one busy tick (the
 * comment above `BATCH` in its route). One slow tick is not an outage, and a panel that cries wolf
 * every busy afternoon is the alarm nobody reads that this whole task exists to avoid.
 */
export const STALE_FLOOR_MS = 10 * 60_000;

/**
 * How old a run may get before the job counts as overdue: **two of its own intervals**, floored.
 *
 * ⚠️ THE NUMBER COMES FROM THE SIDECAR, NOT FROM HERE. `interval_sec` is what the compose loop passed
 * as `?every=`, i.e. the same variable its `sleep` uses. Two intervals = one whole missed cycle plus
 * slack, which for the 15-minute poller is the 30 minutes the alerting review asked for — arrived at
 * from the schedule instead of picked. NULL in, NULL out: a run that never said how often it runs
 * cannot be judged late, and guessing a threshold for it would be exactly the invention this avoids.
 */
export function staleAfterMs(intervalSec: number | null): number | null {
  if (!intervalSec || intervalSec <= 0) return null;
  return Math.max(intervalSec * 2 * 1000, STALE_FLOOR_MS);
}

export type CronState =
  /** No row at all, or a run we cannot judge (it did not report its interval). Neutral — never green. */
  | "unknown"
  /** Ran within its window and reported success. */
  | "ok"
  /** Overdue: the sidecar has not called in two of its own intervals. The container is the first suspect. */
  | "late"
  /** It ran, on time, and told us it could not do its job. */
  | "error";

/** `when` is a whole phrase, not a duration, so the caller never has to decide on a prefix. */
export type CronVerdict = { state: CronState; when: string; note: string };

// ⚠️ THE DECLARATION ORDER IS THE DISPLAY ORDER, and it has to be, because `result` comes back from
// `jsonb` — which does NOT preserve the key order the endpoint wrote. Postgres re-sorts by key length
// then alphabetically, so the summary read "gagal 0 · dipindai 40 · … · resi terisi 0": the count that
// answers "is the poller actually doing anything" ended up last, far from the `scanned` it only means
// anything next to. Keys unknown here (an older container, a counter added later) are appended rather
// than dropped — a number we cannot label is still a number, and losing it silently is the failure
// mode this whole panel exists to stop.
const RESULT_LABELS: Record<string, string> = {
  scanned: "dipindai", awbFilled: "resi terisi", advanced: "status maju", problems: "kendala",
  problemsCleared: "pulih", errors: "gagal",
  claimed: "diambil", sent: "terkirim", failed: "gagal", dead: "mati", released: "dilepas", backfilled: "disusulkan",
  stores: "toko", statusSynced: "status disinkron", invoicesCreated: "tagihan dibuat",
};
const LABEL_ORDER = Object.keys(RESULT_LABELS);

/**
 * The endpoint's own run summary, rendered for a human.
 *
 * Zeroes are KEPT. "resi terisi 0" next to "dipindai 40" is the shape of the failure this table was
 * built for — a poller that wakes on schedule and fills nothing — and dropping empty counters to keep
 * the line short would hide precisely that.
 */
export function summarize(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const e = Object.entries(result as Record<string, unknown>);
  if (e.length === 0) return "";
  const rank = (k: string) => (LABEL_ORDER.indexOf(k) < 0 ? LABEL_ORDER.length : LABEL_ORDER.indexOf(k));
  return e
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([k, v]) => (k === "error" ? String(v) : `${RESULT_LABELS[k] ?? k} ${typeof v === "number" ? v : String(v)}`))
    .join(" · ");
}

export function cronVerdict(run: CronRunRow | undefined, now: number): CronVerdict {
  if (!run) {
    // A job with no row has never reported since this shipped. That is NOT "healthy", and it is not
    // "dead" either — the daily billing loop legitimately takes up to a day to write its first row
    // after a deploy. Saying so is honest; a green tick would be a claim, a red one a false alarm.
    return { state: "unknown", when: "Belum ada laporan", note: "menunggu putaran pertama" };
  }
  const ageMs = now - run.lastRunAt.getTime();
  const when = `Terakhir jalan ${timeAgo(ageMs / 60_000)}`;
  const detail = summarize(run.result);
  const limit = staleAfterMs(run.intervalSec);
  if (limit !== null && ageMs > limit) {
    // Checked BEFORE `ok`: "it has stopped calling" outranks "its last call failed". A stale row's
    // verdict describes a run that may be hours old, and the container is what to look at.
    return { state: "late", when, note: `seharusnya tiap ${everyLabel(run.intervalSec!)} — periksa container cron` };
  }
  if (!run.ok) return { state: "error", when, note: detail || "putaran terakhir gagal" };
  if (limit === null) {
    return { state: "unknown", when, note: detail ? `${detail} · interval tak dilaporkan` : "interval tak dilaporkan" };
  }
  return { state: "ok", when, note: detail || `tiap ${everyLabel(run.intervalSec!)}` };
}

/**
 * Every job on the card, verdict included, against ONE reading of the clock.
 *
 * ⚠️ The clock is read HERE and not in the page, and both halves of that matter. `Date.now()` inside a
 * component is `react-hooks/purity` (it lints, and CLAUDE.md forbids it outright — an impure render is
 * the SSR-vs-client mismatch this repo has already paid for). And reading it once, rather than per row,
 * is what keeps three ages on one card describing the same instant.
 */
export function cronRows(runs: CronRunRow[]): ({ job: string; label: string; what: string } & CronVerdict)[] {
  const now = Date.now();
  return CRON_JOBS.map((j) => ({ ...j, ...cronVerdict(runs.find((r) => r.job === j.job), now) }));
}

function everyLabel(sec: number): string {
  if (sec % 86400 === 0) return `${sec / 86400} hari`;
  if (sec % 3600 === 0) return `${sec / 3600} jam`;
  if (sec % 60 === 0) return `${sec / 60} menit`;
  return `${sec} detik`;
}
