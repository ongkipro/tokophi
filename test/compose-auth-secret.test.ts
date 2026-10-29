import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// EVERY SURFACE THAT USES THE SIGNING SECRET IS HANDED IT BY THE PRODUCTION COMPOSE FILE.
//
// Found 2026-10-29: `docker-compose.coolify.yml` forwarded `AUTH_SECRET` to admin and super-admin only.
// The storefront signs/verifies the abandoned-cart recovery link (`@tokophi/lib/recovery`) and the chat
// visitor token (`src/lib/chat.ts`) with it, and `authSecret()` THROWS in production when it is unset.
// `verifyRecoveryToken` swallows that throw by design, so every WhatsApp recovery link silently opened
// an empty checkout — nothing logged, build and typecheck green. A var set in Coolify reaches a
// container only if its block forwards it, so this reads the blocks, not the Coolify UI.
//
// Derived, not listed: an app counts as a consumer when any of its source files imports the secret
// (`@tokophi/lib/secret`) or the recovery token module that reads it. Compose service = app dir name.
const ROOT = path.resolve(__dirname, "..");
const CONSUMER = /from\s+["']@tokophi\/lib\/(secret|recovery)["']/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(ts|tsx|astro|mjs)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** The `environment:` keys of one top-level service, comment lines removed. */
function serviceEnvKeys(compose: string, service: string): Set<string> | null {
  const lines = compose.split("\n");
  const start = lines.findIndex((l) => l === `  ${service}:`);
  if (start < 0) return null;
  const keys = new Set<string>();
  for (let i = start + 1; i < lines.length && !/^ {2}\S/.test(lines[i]) && !/^\S/.test(lines[i]); i++) {
    const m = /^ {6}([A-Z][A-Z0-9_]*):/.exec(lines[i]);
    if (m) keys.add(m[1]);
  }
  return keys;
}

describe("production compose forwards AUTH_SECRET to every surface that signs with it", () => {
  const compose = readFileSync(path.join(ROOT, "docker-compose.coolify.yml"), "utf8");
  const apps = readdirSync(path.join(ROOT, "apps")).filter((a) => statSync(path.join(ROOT, "apps", a)).isDirectory());
  const consumers = apps.filter((a) => sourceFiles(path.join(ROOT, "apps", a)).some((f) => CONSUMER.test(readFileSync(f, "utf8"))));

  it("finds the consumers (a scan that matches nothing is green forever)", () => {
    expect(consumers).toEqual(expect.arrayContaining(["admin", "super-admin", "storefront"]));
  });

  it.each(consumers)("%s receives AUTH_SECRET", (app) => {
    const keys = serviceEnvKeys(compose, app);
    expect(keys, `no top-level service "${app}" in docker-compose.coolify.yml`).not.toBeNull();
    expect([...keys!]).toContain("AUTH_SECRET");
  });
});
