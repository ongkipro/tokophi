// Pure verdict for the backup card (no fs, no clock of its own) — `backup-health.ts` gathers the facts.

/** The window BOTH sidecar healthchecks use (docker-compose.coolify.yml): one missed 6 h cycle + slack. */
export const BACKUP_STALE_MINUTES = 480;

export type BackupFacts = {
  localMounted: boolean;
  newestDumpAt: Date | null;
  newestDumpBytes: number | null;
  dumpCount: number;
  /** The newest dump has its `.globals.sql` twin (R-22) — without it a fresh cluster cannot be rebuilt. */
  globalsPaired: boolean;
  offsiteMounted: boolean;
  /** Last successful upload round with a FRESH dump (`/state/last-ok`). */
  offsiteOkAt: Date | null;
};

/** `unknown` = this container cannot see the volume: neutral, never green. */
export type BackupState = "ok" | "stale" | "unknown";

export type BackupHealth = BackupFacts & {
  local: BackupState;
  offsite: BackupState;
  /** Minutes since the newest dump / the last offsite success; null when there is none. */
  localAgeMin: number | null;
  offsiteAgeMin: number | null;
  /** Something an operator must act on (stale local, stale offsite, or a dump without its globals). */
  needsAction: boolean;
};

const ageMin = (d: Date | null, now: Date) => (d ? Math.max(0, Math.round((now.getTime() - d.getTime()) / 60_000)) : null);

export function backupVerdict(f: BackupFacts, now: Date): BackupHealth {
  const localAgeMin = ageMin(f.newestDumpAt, now);
  const offsiteAgeMin = ageMin(f.offsiteOkAt, now);
  // Mounted but EMPTY is a failure, not "unknown": the volume is there and holds no recovery point.
  const local: BackupState = !f.localMounted ? "unknown" : localAgeMin !== null && localAgeMin < BACKUP_STALE_MINUTES && f.globalsPaired ? "ok" : "stale";
  const offsite: BackupState = !f.offsiteMounted ? "unknown" : offsiteAgeMin !== null && offsiteAgeMin < BACKUP_STALE_MINUTES ? "ok" : "stale";
  return { ...f, local, offsite, localAgeMin, offsiteAgeMin, needsAction: local === "stale" || offsite === "stale" };
}
