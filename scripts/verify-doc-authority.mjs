#!/usr/bin/env node
// verify:doc-authority — Task 5.14 / NF-16. The authority map in `specs/README.md` names ONE owner
// document per concern; this script keeps that map, and the documents that route readers into it,
// from pointing at nothing. Three claims:
//
//   1. Every `[text](path)` link in the canonical entry documents resolves to a file or directory on
//      disk. The 2026-09-08 audit found the map itself linking four documents that had never been
//      committed on `main` (`TOKOPHI_ACCOUNT_SPEC.md`, `openapi/account.yaml`, `openapi/headless.yaml`,
//      `HEADLESS_STOREFRONT_SPEC.md`) — a reader following the authority map into a 404. Documents
//      checked: `specs/README.md`, the docs table of `AGENTS.md` (backtick paths, since that table
//      uses code spans rather than links), `specs/docs/tasks/OPEN.md`, and the root `STATUS.md`,
//      `ARCHITECTURE.md`, `DECISIONS.md`, `OBSERVABILITY.md`, `RELEASE.md`.
//   2. The authority table (`| Concern | Canonical owner |`) has one owner link per row and no
//      concern twice — an ownership-map check, which Task 5.14's "Done when" asks for by name.
//   3. Exactly ONE file is the execution queue. The README table encodes it as data: the row whose
//      concern names the "queue" owns it, and every other `TASKS.md` in the tree must be listed in
//      the same table as evidence/ledger, and must not describe itself as the canonical or only
//      queue. Root `TASKS.md` is the queue; `specs/docs/TASKS.md` is the epic ledger. Two files
//      claiming the queue is the split source of truth this task exists to prevent.
//
// Usage: node scripts/verify-doc-authority.mjs [--check-file <path> --as <repo-relative-path>]
//   --check-file/--as  check ONE file as if it lived at the given repo path (links resolve relative
//                      to that path; the authority checks run when it stands in for specs/README.md).
//                      Used by test/release-guards.test.ts to prove the guard red on a mutated copy.
// Exit 0 = clean, 1 = a dead link or a broken authority claim, 2 = usage error.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const README = "specs/README.md";
const LINK_DOCS = [README, "specs/docs/tasks/OPEN.md", "STATUS.md", "ARCHITECTURE.md", "DECISIONS.md", "OBSERVABILITY.md", "RELEASE.md"];

const args = process.argv.slice(2);
let only = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--check-file") only = { ...(only ?? {}), file: args[++i] };
  else if (args[i] === "--as") only = { ...(only ?? {}), as: args[++i] };
  else {
    console.error(`unknown argument: ${args[i]}`);
    process.exit(2);
  }
}
if (only && !(only.file && only.as)) {
  console.error("--check-file and --as go together");
  process.exit(2);
}

const problems = [];
const read = (rel) => readFileSync(only && only.as === rel ? only.file : join(ROOT, rel), "utf8");

// ─── 1. links ────────────────────────────────────────────────────────────────────────────────────
function linksOf(text) {
  const out = [];
  // `[text](target)` — target may be wrapped in <>; skip absolute URLs, mailto and pure anchors.
  const re = /\[[^\]]*\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g;
  let m;
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    re.lastIndex = 0;
    while ((m = re.exec(line))) {
      const t = m[1];
      if (/^(https?:|mailto:|#)/i.test(t)) continue;
      out.push({ target: t.replace(/[#?].*$/, ""), line: i + 1 });
    }
  });
  return out;
}
function checkLinks(rel, text) {
  for (const { target, line } of linksOf(text)) {
    if (!target) continue;
    const abs = normalize(join(ROOT, dirname(rel), target));
    if (!existsSync(abs)) problems.push(`${rel}:${line}: dead link → ${target}`);
  }
}
// AGENTS.md's docs table names files in code spans, not links; check the table rows only.
function checkAgentsDocsTable(text) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^\|\s*Doc\s*\|/.test(l));
  if (start < 0) {
    problems.push("AGENTS.md: the docs table (`| Doc | Read it when |`) was not found");
    return;
  }
  for (let i = start + 2; i < lines.length && lines[i].startsWith("|"); i++) {
    for (const m of lines[i].matchAll(/`((?:specs|apps|packages|scripts|test|ops)\/[^`\s]+)`/g)) {
      if (!existsSync(join(ROOT, m[1]))) problems.push(`AGENTS.md:${i + 1}: names a document that is not on disk → ${m[1]}`);
    }
  }
}

const docsToCheck = only ? [only.as] : LINK_DOCS;
for (const rel of docsToCheck) {
  if (rel === "AGENTS.md") continue;
  if (!only && !existsSync(join(ROOT, rel))) {
    problems.push(`${rel}: canonical entry document is missing`);
    continue;
  }
  checkLinks(rel, read(rel));
}
if (!only || only.as === "AGENTS.md") checkAgentsDocsTable(read("AGENTS.md"));

// ─── 2 + 3. the authority map ────────────────────────────────────────────────────────────────────
if (!only || only.as === README) {
  const text = read(README);
  const lines = text.split("\n");
  const header = lines.findIndex((l) => /^\|\s*Concern\s*\|\s*Canonical owner\s*\|/.test(l));
  if (header < 0) problems.push(`${README}: authority table (\`| Concern | Canonical owner |\`) not found`);
  const rows = [];
  for (let i = header + 2; header >= 0 && i < lines.length && lines[i].startsWith("|"); i++) {
    const cells = lines[i].split("|").slice(1, -1).map((c) => c.trim());
    const [concern, owner] = cells;
    const links = [...(owner ?? "").matchAll(/\]\(<?([^)\s>]+)>?\)/g)].map((m) => m[1].replace(/[#?].*$/, ""));
    if (!concern || links.length === 0) problems.push(`${README}:${i + 1}: authority row needs a concern and at least one owner link`);
    if (rows.some((r) => r.concern.toLowerCase() === (concern ?? "").toLowerCase())) problems.push(`${README}:${i + 1}: concern "${concern}" appears twice — one owner per concern`);
    rows.push({ concern: concern ?? "", links: links.map((l) => normalize(join("specs", l))), line: i + 1 });
  }

  // 3. one execution queue.
  const queueRows = rows.filter((r) => /\bqueue\b/i.test(r.concern) && !/evidence|ledger|historical/i.test(r.concern));
  if (queueRows.length !== 1) problems.push(`${README}: expected exactly one authority row whose concern names the execution queue, found ${queueRows.length}`);
  const queueOwner = queueRows[0]?.links[0];
  const allTasksFiles = execFileSync("git", ["ls-files", "TASKS.md", "*/TASKS.md", "**/TASKS.md"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  const claimsQueue = /\b(canonical|only( active)?|sole|single)\b[^.\n]{0,60}\b(execution|remediation)? ?queue\b/i;
  for (const f of allTasksFiles) {
    const head = readFileSync(join(ROOT, f), "utf8").split("\n").slice(0, 40).join("\n");
    if (f === queueOwner) continue;
    if (claimsQueue.test(head)) problems.push(`${f}: describes itself as the execution queue, but ${README} names ${queueOwner} — two files cannot own the queue`);
    const listed = rows.find((r) => r.links.includes(f));
    if (!listed) problems.push(`${f}: a TASKS.md that is not the queue must be listed in ${README}'s authority table as evidence/ledger`);
    else if (!/evidence|ledger|historical/i.test(listed.concern)) problems.push(`${README}:${listed.line}: ${f} is listed but its concern must say it is evidence/ledger, not a queue`);
  }
}

// ─── report ──────────────────────────────────────────────────────────────────────────────────────
console.log(`verify:doc-authority — ${docsToCheck.length + (only ? 0 : 1)} document(s) checked`);
for (const p of problems) console.log(`  ! ${p}`);
if (problems.length) {
  console.log(`\n${problems.length} problem(s).`);
  process.exit(1);
}
console.log("  ok — every canonical link resolves; one owner per concern; one execution queue.");
