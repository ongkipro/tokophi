import { NextResponse, type NextRequest } from "next/server";

import { cronAuthorized } from "@/lib/cron-auth";
import { runPluginCron } from "@/lib/plugins/registry";
import { cronIntervalSec, recordCronRun } from "../record-run";

// FIRST-PARTY PLUGIN WORKER (ADR 0019, KEL-001) — the retry + lead leg of every active plugin. The
// order leg runs from the public order route's `after()`; whatever it skipped (an unpaid prepaid order
// that has since been paid, a Kelola outage, a lost hook) is picked up here.
//
// ⚠️ CROSS-TENANT BY NECESSITY, SCOPED BY HAND — owner pool, so every query in `lib/plugins/**`
// carries an explicit `store_id`; a store whose credential was refused (`broken_at`) is skipped.
// Bounded per store per tick (KELOLA_BATCH), and each row is claimed right before its own POST
// (15 s timeout, 5-minute lease), so an overlapping tick cannot send the same order twice.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  if (!cronAuthorized(req, "cron/plugins")) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const summary = await runPluginCron(new Date());
    const ok = summary.failures.length === 0;
    await recordCronRun("plugins", { ok, startedAt, intervalSec: cronIntervalSec(req), result: summary });
    return NextResponse.json({ ok, ...summary });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[cron/plugins] tick failed", err);
    await recordCronRun("plugins", { ok: false, startedAt, intervalSec: cronIntervalSec(req), result: { error } });
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
