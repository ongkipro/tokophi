import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { backupVerdict, type BackupFacts, type BackupHealth } from "./backup-verdict";

// BACKUP STATUS ON THE OPERATOR'S HOME SCREEN (2026-11-16).
//
// Why: the R2 offsite copy failed with a 401 on 2026-11-15 and nothing told anyone — the sidecars
// turned UNHEALTHY, but an unhealthy container is only a signal if someone looks at `docker ps`
// (SLA-DRP §6 "no alert channel"). The dashboard is what an operator DOES open every morning.
//
// How: `docker-compose.coolify.yml` mounts the two volumes the backup sidecars already write into
// this container READ-ONLY — `tokophi-backups` at /backups and `tokophi-offsite-state` at
// /offsite-state. This file only `stat`s names and reads one epoch stamp; it never opens a dump.
// (Reading a dump would add nothing anyway: this container already holds the owner DB connection.)
//
// No mount (local dev, or the compose change not deployed yet) is reported as UNKNOWN, never as
// healthy — a backup screen that reads green because it cannot see is the exact failure it exists for.
const BACKUP_DIR = process.env.BACKUP_DIR || "/backups";
const OFFSITE_STATE_DIR = process.env.OFFSITE_STATE_DIR || "/offsite-state";

async function localFacts(): Promise<Pick<BackupFacts, "localMounted" | "newestDumpAt" | "newestDumpBytes" | "dumpCount" | "globalsPaired">> {
  let names: string[];
  try {
    names = await fs.readdir(BACKUP_DIR);
  } catch {
    return { localMounted: false, newestDumpAt: null, newestDumpBytes: null, dumpCount: 0, globalsPaired: false };
  }
  // Same SET the sidecars key on: `tokophi-<ts>.dump`, paired with `tokophi-<ts>.globals.sql` (R-22).
  const dumps = names.filter((n) => /^tokophi-\d{8}-\d{6}\.dump$/.test(n));
  let newest: { name: string; mtime: Date; size: number } | null = null;
  for (const name of dumps) {
    const st = await fs.stat(path.join(BACKUP_DIR, name)).catch(() => null);
    if (st && (!newest || st.mtime > newest.mtime)) newest = { name, mtime: st.mtime, size: st.size };
  }
  return {
    localMounted: true,
    newestDumpAt: newest?.mtime ?? null,
    newestDumpBytes: newest?.size ?? null,
    dumpCount: dumps.length,
    globalsPaired: newest ? names.includes(newest.name.replace(/\.dump$/, ".globals.sql")) : false,
  };
}

async function offsiteFacts(): Promise<Pick<BackupFacts, "offsiteMounted" | "offsiteOkAt">> {
  try {
    await fs.access(OFFSITE_STATE_DIR);
  } catch {
    return { offsiteMounted: false, offsiteOkAt: null };
  }
  // `/state/last-ok` holds `date -u +%s`, written ONLY after an upload+prune round with a fresh dump.
  const raw = await fs.readFile(path.join(OFFSITE_STATE_DIR, "last-ok"), "utf8").catch(() => null);
  const secs = raw ? Number.parseInt(raw.trim(), 10) : NaN;
  return { offsiteMounted: true, offsiteOkAt: Number.isFinite(secs) ? new Date(secs * 1000) : null };
}

export async function getBackupHealth(now = new Date()): Promise<BackupHealth> {
  const [local, offsite] = await Promise.all([localFacts(), offsiteFacts()]);
  return backupVerdict({ ...local, ...offsite }, now);
}
