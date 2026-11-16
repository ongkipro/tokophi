import { describe, expect, it } from "vitest";
import { backupVerdict, BACKUP_STALE_MINUTES, type BackupFacts } from "./backup-verdict";

const now = new Date("2026-11-16T10:00:00Z");
const minsAgo = (m: number) => new Date(now.getTime() - m * 60_000);
const healthy: BackupFacts = {
  localMounted: true, newestDumpAt: minsAgo(90), newestDumpBytes: 1_200_000, dumpCount: 56, globalsPaired: true,
  offsiteMounted: true, offsiteOkAt: minsAgo(30),
};

describe("backupVerdict", () => {
  it("fresh dump with its globals + fresh offsite round = ok, nothing to do", () => {
    const v = backupVerdict(healthy, now);
    expect([v.local, v.offsite, v.needsAction]).toEqual(["ok", "ok", false]);
    expect(v.localAgeMin).toBe(90);
  });

  it("the 2026-11-15 shape: local fine, offsite stamp stuck → offsite stale, action needed", () => {
    const v = backupVerdict({ ...healthy, offsiteOkAt: minsAgo(26 * 60) }, now);
    expect([v.local, v.offsite, v.needsAction]).toEqual(["ok", "stale", true]);
  });

  it("uses the sidecars' own 480-minute window, exclusive", () => {
    expect(backupVerdict({ ...healthy, newestDumpAt: minsAgo(BACKUP_STALE_MINUTES - 1) }, now).local).toBe("ok");
    expect(backupVerdict({ ...healthy, newestDumpAt: minsAgo(BACKUP_STALE_MINUTES) }, now).local).toBe("stale");
  });

  it("a dump without its .globals.sql twin is not a recovery point (R-22)", () => {
    expect(backupVerdict({ ...healthy, globalsPaired: false }, now).local).toBe("stale");
  });

  it("mounted but empty / never succeeded is STALE, not unknown", () => {
    const v = backupVerdict({ ...healthy, newestDumpAt: null, dumpCount: 0, globalsPaired: false, offsiteOkAt: null }, now);
    expect([v.local, v.offsite, v.needsAction]).toEqual(["stale", "stale", true]);
  });

  it("no mount = unknown on both sides, and unknown never claims health nor raises an alarm", () => {
    const v = backupVerdict({ ...healthy, localMounted: false, offsiteMounted: false }, now);
    expect([v.local, v.offsite, v.needsAction]).toEqual(["unknown", "unknown", false]);
  });
});
