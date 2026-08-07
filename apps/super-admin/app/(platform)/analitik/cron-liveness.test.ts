import { describe, expect, it } from "vitest";
import { CRON_JOBS, cronVerdict, staleAfterMs, summarize, STALE_FLOOR_MS, type CronRunRow } from "./cron-liveness";

// THE ALARM THAT SAYS THE RESI POLLER IS DEAD.
//
// `cron-tracking` is what makes a waybill appear without the merchant pressing anything, and the
// compose file's own comment records `awbFilled` at 0 for a WEEK while it was not running — the
// evidence existed the whole time, in `docker logs`, which nobody opens without already suspecting
// something. This module is what turns a `cron_runs` row into the red line on Analitik → Sistem, so
// every way it could go quietly green is a way that week happens again.
//
// Four claims, each pinned against the mutation that would break it:
//   1. overdue is TWO of the sidecar's OWN intervals — 900 s ⇒ 30 min, not a constant typed here;
//   2. a job that has never reported is NEUTRAL, never green (a fresh deploy must not cry wolf, and
//      a permanently-silent job must not read "sehat");
//   3. a run with no reported interval is NEUTRAL too — a threshold we cannot derive is not one we
//      may invent;
//   4. `ok: false` is red even when the timing is perfect: the tracking route answers 200 with
//      `{ok:false}` when the courier API is unconfigured, so "it called on time" proves nothing.

const run = (o: Partial<CronRunRow> & { lastRunAt: Date }): CronRunRow => ({
  job: "tracking", intervalSec: 900, ok: true, result: {}, ...o,
});

const NOW = Date.parse("2026-08-06T10:00:00Z");
const agoMin = (m: number) => new Date(NOW - m * 60_000);

describe("staleAfterMs — the threshold comes from the sidecar, not from here", () => {
  it("is two of the loop's own intervals: the 15-minute poller is overdue at 30 minutes", () => {
    expect(staleAfterMs(900)).toBe(30 * 60_000);
  });

  it("never dips below the floor — one slow 8-minute drain tick is not an outage", () => {
    // tracking-events sleeps 60 s; a bare 2× would call it dead after two minutes, while its own
    // route budgets BATCH × timeout ≈ 8 min for a busy tick.
    expect(staleAfterMs(60)).toBe(STALE_FLOOR_MS);
    expect(STALE_FLOOR_MS).toBeGreaterThan(8 * 60_000);
  });

  it("declines to judge a run that did not report its interval", () => {
    expect(staleAfterMs(null)).toBeNull();
    expect(staleAfterMs(0)).toBeNull();
  });
});

describe("cronVerdict", () => {
  it("is green while the poller is calling on schedule", () => {
    expect(cronVerdict(run({ lastRunAt: agoMin(3) }), NOW).state).toBe("ok");
  });

  it("goes RED once the 15-minute poller has been silent for 31 minutes", () => {
    const v = cronVerdict(run({ lastRunAt: agoMin(31) }), NOW);
    expect(v.state).toBe("late");
    expect(v.when).toContain("31 mnt lalu");
    expect(v.note).toContain("container");
  });

  it("is still green at 29 minutes — the boundary is the schedule, not nerves", () => {
    expect(cronVerdict(run({ lastRunAt: agoMin(29) }), NOW).state).toBe("ok");
  });

  it("a job that has never reported is NEUTRAL, never ok", () => {
    const v = cronVerdict(undefined, NOW);
    expect(v.state).toBe("unknown");
    expect(v.state).not.toBe("ok");
  });

  it("a run with no reported interval is NEUTRAL — an underivable threshold is not an invented one", () => {
    const v = cronVerdict(run({ lastRunAt: agoMin(2), intervalSec: null }), NOW);
    expect(v.state).toBe("unknown");
    expect(v.note).toContain("interval");
  });

  it("`ok:false` is red even when it called on time — the tracking route answers 200 for that", () => {
    const v = cronVerdict(run({ lastRunAt: agoMin(1), ok: false, result: { error: "KiriminAja belum dikonfigurasi." } }), NOW);
    expect(v.state).toBe("error");
    expect(v.note).toContain("KiriminAja belum dikonfigurasi.");
  });

  it("silence outranks a failed last run: a stale row's verdict may be hours out of date", () => {
    expect(cronVerdict(run({ lastRunAt: agoMin(90), ok: false }), NOW).state).toBe("late");
  });

  it("shows the run's own counters, ZEROES INCLUDED — 'dipindai 40 · resi terisi 0' is the whole point", () => {
    const v = cronVerdict(run({ lastRunAt: agoMin(1), result: { scanned: 40, awbFilled: 0 } }), NOW);
    expect(v.state).toBe("ok");
    expect(v.note).toContain("dipindai 40");
    expect(v.note).toContain("resi terisi 0");
  });

  it("puts 'resi terisi' next to 'dipindai' whatever order jsonb hands them back in", () => {
    // `result` is a jsonb column: Postgres re-sorts keys by length then alphabetically, so the
    // endpoint's own order is gone by the time it is read. Measured before this was fixed, the line
    // read "gagal 0 · dipindai 40 · … · resi terisi 0" — the one count that says whether the poller
    // is achieving anything, parked at the far end from the only figure it means anything against.
    const jsonbOrder = { dead: 0, errors: 0, problems: 0, scanned: 40, advanced: 2, awbFilled: 0, problemsCleared: 0 };
    const note = cronVerdict(run({ lastRunAt: agoMin(1), result: jsonbOrder }), NOW).note;
    expect(note.indexOf("dipindai")).toBeLessThan(note.indexOf("resi terisi"));
    expect(note.indexOf("resi terisi")).toBeLessThan(note.indexOf("kendala"));
  });

  it("summarize survives a row written before a key existed, or by an older container", () => {
    expect(summarize(null)).toBe("");
    expect(summarize({ somethingNew: 3 })).toBe("somethingNew 3");
  });
});

it("every sidecar in docker-compose.coolify.yml has a row on the card", () => {
  // A cron nobody lists is a cron nobody misses. This assertion keeps every compose sidecar visible;
  // adding another loop without adding it here restores the exact blind spot this closes.
  expect(CRON_JOBS.map((j) => j.job).sort()).toEqual(["billing", "domains", "tracking", "tracking-events"]);
});
