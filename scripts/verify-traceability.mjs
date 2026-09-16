#!/usr/bin/env node
// verify:traceability — Task 5.15 / NF-17. Requirements ↔ evidence ↔ tasks, checked from disk.
//
//   1. REQUIREMENTS: every row in `specs/docs/REQUIREMENTS.md` whose status is MET must name at
//      least one piece of EVIDENCE that exists: a repository path (a test file, a route, a script —
//      also matched by bare basename, `route-roles.test.ts`), a migration number (`0045`,
//      `migration 0098`) present in `packages/db/drizzle/`, a package script (`npm run verify-rls -w
//      @tokophi/db`) declared in that workspace's package.json, or a `BUILD-LOG.md` anchor (the file
//      named beside a date that occurs in it). A MET row with none is a claim nobody can re-run.
//      Separately, ANY row — MET or not — that names a repository path which does not exist has a
//      dead pointer, and a dead pointer is a doc bug regardless of status; it is reported and fails.
//      The fix is to point at the real file, never to flip the status.
//   2. TASKS: every ACTIVE task in root `TASKS.md` (Stages 4–8 — the file's own header says Stages
//      0–3 are historical intake) must carry a `**Requirement:**` line whose ids exist in
//      REQUIREMENTS; a `**Tracing:**` id (`AD-3`, `SEC-C1`) must exist in REQUIREMENTS or in an audit
//      document — one the line names by path, or `AUDIT-SUMMARY.md` / a `specs/docs/tasks/*report*.md`.
//      A task whose Requirement line names no id at all is reported as an ORPHAN (it cannot fail the
//      gate: the fix is editing TASKS.md to classify it, which is a judgement, not a typo).
//   3. ORPHANS the other way: an active (non-MET) requirement that no active task names is listed
//      so it is not SILENTLY orphaned. Reported, not failed — a missing task is a planning decision.
//
// Usage: node scripts/verify-traceability.mjs [--requirements <file>] [--tasks <file>]
//   overrides exist for test/release-guards.test.ts, which proves the guard red on a mutated copy.
// Exit 0 = clean, 1 = a MET row without evidence, a dead evidence path, or a task id that resolves
// nowhere; 2 = usage error.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
let reqFile = join(ROOT, "specs/docs/REQUIREMENTS.md");
let tasksFile = join(ROOT, "TASKS.md");
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--requirements") reqFile = args[++i];
  else if (args[i] === "--tasks") tasksFile = args[++i];
  else {
    console.error(`unknown argument: ${args[i]}`);
    process.exit(2);
  }
}
for (const f of [reqFile, tasksFile]) {
  if (!existsSync(f)) {
    console.error(`not found: ${f}`);
    process.exit(2);
  }
}

// ─── repository facts the evidence is checked against ────────────────────────────────────────────
const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
const trackedSet = new Set(tracked);
const byBasename = new Map();
for (const f of tracked) {
  const b = basename(f);
  if (!byBasename.has(b)) byBasename.set(b, []);
  byBasename.get(b).push(f);
}
const migrationDir = join(ROOT, "packages/db/drizzle");
const migrations = new Set(readdirSync(migrationDir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).map((f) => f.slice(0, 4)));
const buildLog = readFileSync(join(ROOT, "BUILD-LOG.md"), "utf8");
const workspaceScripts = new Map(); // "@tokophi/db" → Set(scripts)
{
  const root = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  workspaceScripts.set("", new Set(Object.keys(root.scripts ?? {})));
  for (const f of tracked.filter((p) => /^(apps|packages)\/[^/]+\/package\.json$/.test(p))) {
    const pkg = JSON.parse(readFileSync(join(ROOT, f), "utf8"));
    workspaceScripts.set(pkg.name, new Set(Object.keys(pkg.scripts ?? {})));
  }
}
const ID = /\b([A-Z]{1,5}-[A-Z]{0,3}\d+)\b/g;

// ─── evidence classification of one table cell ───────────────────────────────────────────────────
const PATH_PREFIX = /^(apps|packages|specs|test|scripts|ops|docker|\.github)\//;
const SOURCE_EXT = /\.(tsx?|mjs|cjs|js|astro|sql|ya?ml|json|css|sh|md)$/;
function pathExists(p) {
  if (trackedSet.has(p) || existsSync(join(ROOT, p))) return true;
  return false;
}
/** Returns { found: [...descriptions], dead: [...paths] } for the evidence in a cell. */
function evidenceIn(cell) {
  const found = [];
  const dead = [];
  const seen = new Set();
  for (const m of cell.matchAll(/`([^`]+)`/g)) {
    let tok = m[1].trim().replace(/#[^#]*$/, "").replace(/:\d+$/, "").replace(/[),.;:]+$/, "");
    if (!tok || seen.has(tok)) continue;
    seen.add(tok);
    // A URL (`/api/uploads/*`) or a column family (`payouts.bank_*`) is not a repository path.
    if (tok.startsWith("/") || (tok.includes("*") && !tok.includes("/"))) continue;
    // A glob (`apps/admin/lib/actions/*.ts`) names a family, not a file — its directory must exist.
    if (tok.includes("*") && !/\s/.test(tok)) {
      const dir = tok.slice(0, tok.lastIndexOf("/"));
      if (dir && pathExists(dir)) found.push(`glob ${tok}`);
      else if (dir) dead.push(tok);
      continue;
    }
    const looksLikePath = (PATH_PREFIX.test(tok) && !/\s/.test(tok)) || (SOURCE_EXT.test(tok) && !/\s/.test(tok));
    if (looksLikePath) {
      // REQUIREMENTS.md lives in specs/docs, so a bare `FOO.md` or `../openapi/x.yaml` is relative to it.
      const relToDoc = normalize(join("specs/docs", tok));
      // An app-relative path (`lib/rbac-policy.ts`, `src/pages/sitemap.xml.ts`) matches by suffix.
      const bySuffix = tok.includes("/") ? tracked.filter((f) => f.endsWith("/" + tok)) : [];
      if (pathExists(tok)) found.push(`path ${tok}`);
      else if (!tok.startsWith("..") && !tok.includes("/") && byBasename.has(tok)) found.push(`file ${byBasename.get(tok)[0]}`);
      else if (pathExists(relToDoc)) found.push(`path ${relToDoc}`);
      else if (bySuffix.length) found.push(`file ${bySuffix[0]}`);
      else if (tok === "BUILD-LOG.md") {
        // A BUILD-LOG anchor is a date that actually occurs in the log.
        const dates = [...cell.matchAll(/\b(20\d\d-\d\d-\d\d)\b/g)].map((d) => d[1]);
        const hit = dates.find((d) => buildLog.includes(d));
        if (hit) found.push(`BUILD-LOG.md @ ${hit}`);
        else dead.push("BUILD-LOG.md (no date from this row occurs in the log)");
      } else dead.push(tok);
      continue;
    }
    const npm = tok.match(/^npm run ([\w:-]+)(?:\s+-w\s+(@?[\w/-]+))?/);
    if (npm) {
      // `npm run build` with no -w is "in the app", so any workspace declaring it counts.
      const scripts = npm[2] ? workspaceScripts.get(npm[2]) : new Set([...workspaceScripts.values()].flatMap((v) => [...v]));
      if (scripts?.has(npm[1])) found.push(`script ${tok}`);
      else dead.push(`npm script ${tok}`);
      continue;
    }
    // `npx tsx scripts/foo.ts`, `grep -rn "…" apps/ packages/` — the files or directories inside a
    // command are what makes it runnable; a grep over a directory that exists is a repeatable check.
    for (const inner of tok.matchAll(/(?:^|\s)((?:apps|packages|specs|test|scripts|ops)\/[^\s'"]*)/g)) {
      const p = inner[1].replace(/\/$/, "");
      if (p.includes("*")) continue;
      if (pathExists(p)) found.push(`path ${p}`);
      else dead.push(p);
    }
  }
  // Migration numbers: "migration 0045", "(0098)", "0044 / 0045" — in prose, not just code spans.
  for (const m of cell.matchAll(/\b(?:migrations?\s+)?\b(00\d\d|01\d\d)\b/g)) {
    if (migrations.has(m[1])) {
      found.push(`migration ${m[1]}`);
    }
  }
  return { found, dead };
}

// ─── 1. REQUIREMENTS ─────────────────────────────────────────────────────────────────────────────
const problems = [];
const warnings = [];
const reqLines = readFileSync(reqFile, "utf8").split("\n");
const requirements = new Map(); // id → { line, status, met, found, dead }
const splitRow = (line) => line.replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim());
reqLines.forEach((line, i) => {
  const m = line.match(/^\|\s*\*{0,2}([A-Z]{1,5}-[A-Z]{0,3}\d+)\*{0,2}\s*\|/);
  if (!m) return;
  const cells = splitRow(line);
  const status = cells[cells.length - 1];
  const evidenceCells = cells.slice(1).join(" ");
  const { found, dead } = evidenceIn(evidenceCells);
  const met = /^\*{0,2}MET\b/.test(status);
  if (requirements.has(m[1])) problems.push(`REQUIREMENTS.md:${i + 1}: id ${m[1]} appears twice (also line ${requirements.get(m[1]).line})`);
  requirements.set(m[1], { line: i + 1, status, met, found, dead });
});
for (const [id, r] of requirements) {
  for (const d of r.dead) problems.push(`REQUIREMENTS.md:${r.line}: ${id} names evidence that does not exist → ${d}`);
  if (r.met && r.found.length === 0) problems.push(`REQUIREMENTS.md:${r.line}: ${id} is MET but names no evidence that exists (test file, migration, package script or BUILD-LOG anchor)`);
}

// ─── 2. TASKS ────────────────────────────────────────────────────────────────────────────────────
const taskLines = readFileSync(tasksFile, "utf8").split("\n");
const auditDocs = [
  "specs/docs/AUDIT-SUMMARY.md",
  ...tracked.filter((f) => /^specs\/docs\/tasks\/.*report.*\.md$/.test(f)),
].filter((f) => existsSync(join(ROOT, f)));
const docCache = new Map();
const docHas = (rel, id) => {
  if (!docCache.has(rel)) docCache.set(rel, existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : "");
  return new RegExp(`\\b${id}\\b`).test(docCache.get(rel));
};
const tasks = []; // { id, stage, line, requirementIds, tracingIds, hasRequirementLine }
let cur = null;
taskLines.forEach((line, i) => {
  const h = line.match(/^### Task (\d+)\.(\d+)\b/);
  if (h) {
    cur = { id: `${h[1]}.${h[2]}`, stage: Number(h[1]), line: i + 1, requirementIds: [], tracingIds: [], namedDocs: [], hasRequirementLine: false };
    tasks.push(cur);
    return;
  }
  if (!cur) return;
  const req = line.match(/^- \*\*Requirement:\*\*\s*(.*)$/);
  if (req) {
    cur.hasRequirementLine = true;
    cur.requirementIds.push(...[...req[1].matchAll(/`([A-Z]{1,5}-[A-Z]{0,3}\d+)`/g)].map((m) => m[1]));
  }
  const tr = line.match(/^- \*\*Tracing:\*\*\s*(.*)$/);
  if (tr) {
    cur.tracingIds.push(...[...tr[1].matchAll(ID)].map((m) => m[1]));
    cur.namedDocs.push(...[...tr[1].matchAll(/`([^`\s]+\.md)`/g)].map((m) => m[1]));
  }
});
const active = tasks.filter((t) => t.stage >= 4);
const namedByTasks = new Set();
for (const t of active) {
  if (!t.hasRequirementLine || t.requirementIds.length === 0) warnings.push(`TASKS.md:${t.line}: Task ${t.id} names no requirement id — orphan task (classify it against REQUIREMENTS.md)`);
  for (const id of t.requirementIds) {
    if (!requirements.has(id)) problems.push(`TASKS.md:${t.line}: Task ${t.id} requires ${id}, which is not in REQUIREMENTS.md`);
    else namedByTasks.add(id);
  }
  for (const id of new Set(t.tracingIds)) {
    if (requirements.has(id)) {
      namedByTasks.add(id);
      continue;
    }
    const docs = [...t.namedDocs.map((d) => (d.startsWith("specs/") ? d : `specs/docs/tasks/${basename(d)}`)), ...auditDocs];
    if (!docs.some((d) => docHas(d, id))) problems.push(`TASKS.md:${t.line}: Task ${t.id} traces ${id}, which is in neither REQUIREMENTS.md nor an audit document (${docs.map((d) => basename(d)).join(", ")})`);
  }
}

// ─── 3. requirements nobody is working on ────────────────────────────────────────────────────────
for (const [id, r] of requirements) {
  if (r.met || namedByTasks.has(id)) continue;
  warnings.push(`REQUIREMENTS.md:${r.line}: ${id} is ${r.status.replace(/\*/g, "").split(/\s[—-]\s|:/)[0].trim()} and no active task names it`);
}

// ─── report ──────────────────────────────────────────────────────────────────────────────────────
const met = [...requirements.values()].filter((r) => r.met).length;
console.log(`verify:traceability — ${requirements.size} requirements (${met} MET), ${active.length} active tasks (Stage ≥ 4) of ${tasks.length}`);
for (const p of problems) console.log(`  ! ${p}`);
for (const w of warnings) console.log(`  ~ ${w}`);
if (problems.length) {
  console.log(`\n${problems.length} problem(s), ${warnings.length} orphan report(s).`);
  process.exit(1);
}
console.log(`  ok — every MET requirement names evidence that exists; every active task id resolves. ${warnings.length} orphan report(s) above are informational.`);
