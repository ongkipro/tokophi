import { db, schema } from "@tokophi/db";
import type { NextRequest } from "next/server";

// CRON LIVENESS — the write half. Every sidecar tick leaves ONE upserted row in `cron_runs` (0091),
// which Super Admin → Analitik → Sistem renders as "terakhir jalan N menit lalu", red once overdue.
//
// This exists because `cron-tracking` — the loop that makes a waybill appear without the merchant
// pressing anything — sat dead for a week with `awbFilled` at 0 and the only trace was a line in
// `docker logs`, which nobody opens without a reason. A log is not a signal: something has to be
// looking at it. Now a screen the operator already has open is.
//
// Not a route file: anything under `app/` that is not `route.ts`/`page.tsx` is not routable, so this
// is a plain module that happens to live next to its three callers.

/** The three compose sidecars. Adding a job here means adding it to the reader's list too. */
export type CronJob = "billing" | "tracking" | "tracking-events";

/**
 * The sidecar's OWN cadence, forwarded as `?every=<seconds>` from the same compose variable its
 * `sleep` uses.
 *
 * ⚠️ IT IS NOT DEFAULTED, AND THAT IS THE POINT. The staleness threshold on the other end is derived
 * from this number, so hard-coding "900" here would put a second copy of the schedule in application
 * code — one that keeps claiming 15 minutes the day somebody edits the compose file to 5. A caller
 * that does not say (an operator's manual `curl`, an older compose) records NULL, and the reader
 * declines to judge rather than invent a threshold.
 *
 * Bounded because it arrives on an unauthenticated-shaped query string: anything absurd is treated as
 * "not reported" rather than becoming a week-long threshold that never goes red.
 */
export function cronIntervalSec(req: NextRequest): number | null {
  const raw = req.nextUrl.searchParams.get("every");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 && n <= 7 * 24 * 3600 ? Math.round(n) : null;
}

/**
 * Record the outcome of one tick. NEVER throws.
 *
 * A monitoring write must not be able to break the thing it monitors: if this table is missing (a
 * container running ahead of its migration) or the DB blips, the sweep it just finished is still real
 * work that must be reported to the caller. The failure surfaces as the row going stale, which is
 * exactly the signal this table exists to produce.
 */
export async function recordCronRun(
  job: CronJob,
  o: { ok: boolean; startedAt: number; intervalSec: number | null; result: Record<string, unknown> },
): Promise<void> {
  const row = {
    lastRunAt: new Date(),
    intervalSec: o.intervalSec,
    ok: o.ok,
    durationMs: Math.round(Date.now() - o.startedAt),
    result: o.result,
  };
  try {
    await db
      .insert(schema.cronRuns)
      .values({ job, ...row })
      .onConflictDoUpdate({ target: schema.cronRuns.job, set: row });
  } catch (err) {
    console.error(`[cron/${job}] could not record the run`, err);
  }
}
