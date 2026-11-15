import { readdirSync, statSync } from "node:fs";
import path from "node:path";

// Shared by the compose-forwarding guards: a var set in Coolify reaches a container ONLY if that
// service's `environment:` block in docker-compose.coolify.yml forwards it.

/** Every non-test source file under `dir` (ts/tsx/astro/mjs), node_modules and dot-dirs skipped. */
export function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(ts|tsx|astro|mjs)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** The `environment:` keys of one top-level service, comment lines removed. `null` = no such service. */
export function serviceEnvKeys(compose: string, service: string): Set<string> | null {
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
