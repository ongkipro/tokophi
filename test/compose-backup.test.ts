import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// THE BACKUP SIDECARS' PROMISES, pinned (2026-11-16). Each was exercised in the real images before it
// was pinned here (BUILD-LOG 2026-11-16): a truncated pg_dump used to log `backup-ok` and leave a
// 300-byte "recovery point"; a differing remote copy used to be silently overwritten.
const ROOT = path.resolve(__dirname, "..");
const COMPOSE = readFileSync(path.join(ROOT, "docker-compose.coolify.yml"), "utf8");

/** One top-level service's lines, comment lines dropped — a promise in a comment is not a promise. */
function service(src: string, name: string): string {
  const lines = src.split("\n");
  const start = lines.findIndex((l) => l === `  ${name}:`);
  if (start < 0) return "";
  const out: string[] = [];
  for (let i = start + 1; i < lines.length && !/^ {2}\S/.test(lines[i]) && !/^\S/.test(lines[i]); i++) {
    if (!/^\s*#/.test(lines[i])) out.push(lines[i]);
  }
  return out.join("\n");
}

const checks = (src: string) => {
  const backup = service(src, "backup");
  const offsite = service(src, "backup-offsite");
  const superAdmin = service(src, "super-admin");
  return {
    // The archive is read back BEFORE the rename that turns a `.part` into a recovery point.
    verifiesBeforeRename: /pg_restore\s+--list\s+"\$\$f\.part"[\s\S]*?mv\s+"\$\$f\.part"/.test(backup),
    immutableCopy: /rclone\s+copy\b[^\n]*--immutable\b/.test(offsite),
    heartbeatOptional: /BACKUP_HEARTBEAT_URL:\s*\$\{BACKUP_HEARTBEAT_URL:-\}/.test(offsite),
    // Never echoed: no `echo` line may carry the URL (it is a credential of sorts).
    heartbeatNeverEchoed: !/echo[^\n]*BACKUP_HEARTBEAT_URL/.test(offsite),
    statusMountsReadOnly:
      /-\s*tokophi-backups:\/backups:ro\b/.test(superAdmin) && /-\s*tokophi-offsite-state:\/offsite-state:ro\b/.test(superAdmin),
  };
};

describe("backup sidecars (docker-compose.coolify.yml)", () => {
  it("keeps every promise", () => {
    expect(checks(COMPOSE)).toEqual({
      verifiesBeforeRename: true,
      immutableCopy: true,
      heartbeatOptional: true,
      heartbeatNeverEchoed: true,
      statusMountsReadOnly: true,
    });
  });

  it("self-check: the pre-2026-11-16 compose fails every new promise", () => {
    let old: string;
    try {
      old = execFileSync("git", ["show", "c95557eb:docker-compose.coolify.yml"], { cwd: ROOT, encoding: "utf8" });
    } catch {
      return; // shallow clone without that commit — the main assertion above still stands
    }
    const c = checks(old);
    expect([c.verifiesBeforeRename, c.immutableCopy, c.heartbeatOptional, c.statusMountsReadOnly]).toEqual([false, false, false, false]);
  });
});
