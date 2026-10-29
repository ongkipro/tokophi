#!/usr/bin/env node
// Generates `specs/docs/PAGE_MAP.md` — the page-level map of all four surfaces, DERIVED FROM DISK.
//
// Why a generator and not prose: `CODE_MAP.md` said "admin — 39 routes" while the directory held 55,
// and `SYSTEM_MAP.md` still described the 2-minute impersonation JWT that Task 4.11 replaced. A map
// written by hand is a snapshot that reads as current. This one is a function of the tree: run it
// again and it is right again, and `test/page-map-fresh.test.ts` fails when the committed copy no
// longer matches — same discipline as `route-roles.test.ts` (page list from the directory) and
// `checks-registered.test.ts` (check list from the directory).
//
// What it records per route, all read from the route file's own imports:
//   - the URL path (from the file path, Next/Astro conventions)
//   - the file, and the `*-client.tsx` siblings a page delegates to
//   - `lib/data/*` and `lib/actions/*` modules it imports (admin + super-admin), `src/data/*` and
//     `src/lib/*` (storefront), the layout (Astro)
//   - the gate it declares: `requireCapability("…")` / `getSession` / `platformRouteGate("…")` /
//     `cronAuth` / `readPublicBody` / `rateLimited` — or NONE, which is the row worth reading
//   - the tests that name the route's directory or file (a grep over `*.test.ts(x)`)
//
// It reads CODE, not text (`test/source-code.ts` → `codeOnly`): a commented-out `requireCapability`
// must not count as a gate. Usage: `node scripts/gen-page-map.mjs` (writes) · `--check` (diff only).

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, dirname, basename } from "node:path";
import ts from "typescript";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(ROOT, "specs/docs/PAGE_MAP.md");
// Same facts, machine-readable — for an agent that wants to QUERY the map ("which pages import
// lib/data/orders?", "which API routes have no gate?") instead of scanning a 300-line table. Written
// and checked together with the markdown, so the two cannot drift.
const OUT_JSON = join(ROOT, "specs/docs/page-map.json");

// ─── code-only view (mirrors test/source-code.ts, which is TypeScript and not importable from .mjs) ──
function codeOnly(src) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.JSX, src);
  const out = [];
  let tok;
  while ((tok = scanner.scan()) !== ts.SyntaxKind.EndOfFileToken) {
    if (tok === ts.SyntaxKind.WhitespaceTrivia || tok === ts.SyntaxKind.NewLineTrivia) continue;
    if (tok === ts.SyntaxKind.SingleLineCommentTrivia || tok === ts.SyntaxKind.MultiLineCommentTrivia) continue;
    if (tok === ts.SyntaxKind.StringLiteral || tok === ts.SyntaxKind.NoSubstitutionTemplateLiteral) {
      // Keep the literal's contents: import specifiers and capability names ARE strings.
      out.push(JSON.stringify(scanner.getTokenValue()));
      continue;
    }
    out.push(scanner.getTokenText());
  }
  return out.join(" ");
}

function walk(dir, pred, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    // Dot-directories hold `.claude/worktrees/*` — dozens of stale agent checkouts, each a full copy of
    // the tree. Walking them multiplied every test hit by ~35 on the first run.
    if (name === "node_modules" || name === ".next" || name === "dist" || name.startsWith(".")) continue;
    if (statSync(p).isDirectory()) walk(p, pred, acc);
    else if (pred(p)) acc.push(p);
  }
  return acc;
}

function read(p) {
  return readFileSync(p, "utf8");
}

const rel = (p) => relative(ROOT, p).replaceAll("\\", "/");

// ─── Next.js: file path → URL ────────────────────────────────────────────────────────────────────
function nextUrl(appDir, file) {
  const r = relative(appDir, file).replaceAll("\\", "/");
  const segs = r.split("/").slice(0, -1).filter((s) => !/^\(.*\)$/.test(s));
  const p = "/" + segs.join("/");
  return p === "/" ? "/" : p;
}

// Astro: file path → URL
function astroUrl(pagesDir, file) {
  let r = relative(pagesDir, file).replaceAll("\\", "/");
  r = r.replace(/\.(astro|ts)$/, "");
  if (r.endsWith("/index")) r = r.slice(0, -"/index".length);
  if (r === "index") r = "";
  // `robots.txt.ts` → /robots.txt ; `feed/google.xml.ts` → /feed/google.xml
  return "/" + r;
}

// ─── import extraction ────────────────────────────────────────────────────────────────────────────
function imports(code) {
  return [...code.matchAll(/\bfrom\s+"([^"]+)"/g)].map((m) => m[1]);
}
function pick(specs, prefix) {
  return [...new Set(specs.filter((s) => s.startsWith(prefix)).map((s) => s.slice(prefix.length)))].sort();
}

// ─── gate detection (on CODE) ─────────────────────────────────────────────────────────────────────
function gates(code) {
  const g = [];
  for (const m of code.matchAll(/requireCapability\s*\(\s*"([^"]+)"/g)) g.push(`cap:${m[1]}`);
  if (/\brequireCapability\s*\(/.test(code) && !g.length) g.push("cap:(dynamic)");
  for (const m of code.matchAll(/platformRouteGate\s*\(\s*"([^"]+)"/g)) g.push(`route:${m[1]}`);
  for (const m of code.matchAll(/platformGate\s*\(\s*"([^"]+)"/g)) g.push(`rank:${m[1]}`);
  if (/\bgetSession\s*\(/.test(code)) g.push("session");
  if (/\bgetPlatformSession\s*\(/.test(code)) g.push("platform-session");
  if (/\brequirePlatformAdmin\s*\(/.test(code)) g.push("platform-admin");
  if (/\bcronAuthorized\s*\(/.test(code)) g.push("cron");
  if (/\bauthorizeCallback\s*\(/.test(code)) g.push("callback-auth");
  if (/\breadPublicBody\s*\(/.test(code)) g.push("public-body");
  // `rateLimit(`, `rateLimited(` — NOT `rateLimited?`, which is "rateLimite" + optional "d" and matched nothing (found 2026-09-04).
  if (/\brateLimit(?:ed)?\s*\(/.test(code)) g.push("rate-limit");
  if (/\bisBot\s*\(/.test(code)) g.push("bot");
  if (/\bwithCurrentTenant\s*\(/.test(code)) g.push("tenant");
  if (/\bwithTenant\s*\(/.test(code)) g.push("tenant");
  return [...new Set(g)];
}

function methods(code) {
  return [...code.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g)]
    .map((m) => m[1])
    .concat([...code.matchAll(/export\s+const\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g)].map((m) => m[1]));
}

const isDynamic = (code) => /export\s+const\s+dynamic\s*=\s*"force-dynamic"/.test(code);

// ─── tests that name a route ──────────────────────────────────────────────────────────────────────
const TEST_FILES = walk(ROOT, (p) => /\.test\.tsx?$/.test(p) && !p.includes("/node_modules/"));
const TEST_TEXT = new Map(TEST_FILES.map((p) => [p, read(p)]));
function testsFor(file, urlPath) {
  const dir = rel(dirname(file)); // apps/admin/app/(admin)/diskon
  const app = dir.split("/").slice(0, 2).join("/"); // apps/admin
  const inApp = dir.split("/").slice(2).join("/"); // app/(admin)/diskon
  const hits = [];
  for (const [t, text] of TEST_TEXT) {
    if (t === file) continue;
    const tRel = rel(t);
    // A test names the route's file (`src/pages/404.astro`) or, for a route that has a directory of
    // its own (`app/(admin)/diskon/`, depth ≥ 3 — `app/` and `src/pages/` alone match everything),
    // that directory — from anywhere in the repo…
    const inAppFile = inApp + "/" + basename(file);
    const namesDir =
      text.includes(inAppFile) || (inApp.split("/").length >= 3 && (text.includes(inApp + "/") || text.includes(inApp + '"')));
    // …or its URL as a quoted string — but only a test in the SAME app, or the repo-root `test/`
    // folder: `/analitik` exists on two surfaces, and super-admin's `route-roles.test.ts` naming its
    // own `/analitik` says nothing about the Seller's.
    const sameApp = tRel.startsWith(app + "/") || tRel.startsWith("test/");
    const namesUrl =
      sameApp && urlPath.length > 1 && new RegExp(`["'\`]${urlPath.replace(/[[\]]/g, "\\$&")}["'\`?/]`).test(text);
    if (namesDir || namesUrl) hits.push(tRel);
  }
  return hits.sort();
}

// ─── per-surface collectors ───────────────────────────────────────────────────────────────────────
function nextSurface(app, label) {
  const appDir = join(ROOT, "apps", app, "app");
  const files = walk(appDir, (p) => /\/(page|layout|route)\.tsx?$/.test(p)).sort();
  const rows = files.map((f) => {
    const src = read(f);
    const code = codeOnly(src);
    const specs = imports(code);
    const kind = basename(f).startsWith("route") ? "api" : basename(f).startsWith("layout") ? "layout" : "page";
    const url = nextUrl(appDir, f);
    const dir = dirname(f);
    const clients = readdirSync(dir)
      .filter((n) => /-client\.tsx$/.test(n) || (/\.tsx$/.test(n) && !/^(page|layout|route)\./.test(n) && !/\.test\./.test(n)))
      .sort();
    const localData = pick(specs, "@/lib/data/");
    const localActions = pick(specs, "@/lib/actions/");
    const saData = specs.includes("@/lib/data") ? ["data"] : [];
    const saActions = specs.includes("@/lib/actions") ? ["actions"] : [];
    // A page that delegates to a client component: its gate and actions live there too.
    let clientGates = [];
    let clientActions = [];
    for (const c of clients) {
      const cc = codeOnly(read(join(dir, c)));
      clientGates.push(...gates(cc).filter((g) => g.startsWith("cap:")));
      clientActions.push(...pick(imports(cc), "@/lib/actions/"));
      if (imports(cc).includes("@/lib/actions")) clientActions.push("actions");
    }
    return {
      url,
      kind,
      methods: kind === "api" ? methods(code) : [],
      file: rel(f),
      clients,
      data: [...localData, ...saData],
      actions: [...new Set([...localActions, ...saActions, ...clientActions])].sort(),
      gate: gates(code),
      clientGates: [...new Set(clientGates)],
      dynamic: isDynamic(code),
      ownerDb: /\bfrom\s+"@tokophi\/db"/.test(code) && /\bdb\b/.test(code) && !/\bwithCurrentTenant\b|\bwithTenant\b/.test(code),
      tests: testsFor(f, url),
    };
  });
  return { app, label, rows };
}

function astroSurface(app, label) {
  const pagesDir = join(ROOT, "apps", app, "src/pages");
  // Astro excludes any path segment starting with `_` from routing, so a partial living beside its page
  // (`affiliate/_Ledger.astro`) is a component, not a route. Listing one as a URL would invent a page that
  // 404s. No surface had such a partial before `account`, which is why this filter arrives with it.
  const files = walk(pagesDir, (p) => /\.(astro|ts)$/.test(p) && !/\.test\.ts$/.test(p))
    .filter((f) => !rel(f).slice(rel(pagesDir).length).split("/").some((seg) => seg.startsWith("_")))
    .sort();
  const rows = files.map((f) => {
    const src = read(f);
    // Astro frontmatter is between the first two `---` lines; endpoints are plain TS.
    const fm = f.endsWith(".astro") ? (src.match(/^---\n([\s\S]*?)\n---/) || [, ""])[1] : src;
    const code = codeOnly(fm);
    const specs = imports(code);
    const layout = specs.filter((s) => /layouts\//.test(s)).map((s) => s.replace(/.*layouts\//, "").replace(/\.astro$/, ""));
    return {
      url: astroUrl(pagesDir, f),
      kind: f.endsWith(".astro") ? "page" : "endpoint",
      methods: f.endsWith(".astro") ? [] : methods(code),
      file: rel(f),
      layout,
      data: pick(specs, "../data/").concat(pick(specs, "../../data/")).map((s) => s.replace(/\.ts$/, "")),
      lib: pick(specs, "../lib/").concat(pick(specs, "../../lib/")).map((s) => s.replace(/\.ts$/, "")),
      locals: /Astro\s*\.\s*locals|locals\s*\.\s*(store|catalog)/.test(code),
      db: specs.includes("@tokophi/db"),
      gate: gates(code),
      setHtml: /set\s*:\s*html/.test(src),
      tests: testsFor(f, astroUrl(pagesDir, f)),
    };
  });
  return { app, label, rows };
}

// ─── render ───────────────────────────────────────────────────────────────────────────────────────
// ─── "what it is" — hand-curated, merged here so the generated map also answers WHY a page exists ──
// `scripts/page-descriptions.json` is keyed `<app>:<url>`. The generator refuses to run when a page,
// API route or endpoint has no line there, or a line names a route that no longer exists — so the
// column can neither be skipped for a new page nor rot after a rename. Layouts are described in place.
const DESCRIPTIONS = JSON.parse(read(join(ROOT, "scripts/page-descriptions.json")));
const describe = (app, r) => (r.kind === "layout" ? "layout" : DESCRIPTIONS.routes[`${app}:${r.url}`]);
function checkDescriptions(surfaces) {
  const wanted = new Set();
  const missing = [];
  for (const s of surfaces)
    for (const r of s.rows) {
      if (r.kind === "layout") continue;
      const key = `${s.app}:${r.url}`;
      wanted.add(key);
      if (!DESCRIPTIONS.routes[key]) missing.push(key);
    }
  const extra = Object.keys(DESCRIPTIONS.routes).filter((k) => !wanted.has(k));
  if (missing.length || extra.length) {
    if (missing.length) console.error(`scripts/page-descriptions.json — no description for: ${missing.join(", ")}`);
    if (extra.length) console.error(`scripts/page-descriptions.json — describes a route that no longer exists: ${extra.join(", ")}`);
    process.exit(1);
  }
}

const code = (s) => (s ? `\`${s}\`` : "");
const list = (xs) => (xs && xs.length ? xs.map(code).join(" ") : "—");
const yn = (b) => (b ? "✓" : "");

function renderNext(s) {
  const pages = s.rows.filter((r) => r.kind !== "api");
  const apis = s.rows.filter((r) => r.kind === "api");
  let md = `## ${s.label} — \`apps/${s.app}\`\n\n`;
  md += `${pages.filter((r) => r.kind === "page").length} pages · ${pages.filter((r) => r.kind === "layout").length} layouts · ${apis.length} API routes\n\n`;
  md += `### Pages\n\n| URL | what it is | kind | file | client component(s) | lib/data | lib/actions (page + client) | gate (page) | gate (client) | dyn | tests |\n|---|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const r of pages) {
    md += `| ${code(r.url)} | ${describe(s.app, r)} | ${r.kind} | ${code(r.file)} | ${list(r.clients)} | ${list(r.data)} | ${list(r.actions)} | ${list(r.gate)} | ${list(r.clientGates)} | ${yn(r.dynamic)} | ${list(r.tests)} |\n`;
  }
  md += `\n### API routes\n\n| URL | what it is | methods | file | gate | owner \`db\` | tests |\n|---|---|---|---|---|---|---|\n`;
  for (const r of apis) {
    md += `| ${code(r.url)} | ${describe(s.app, r)} | ${r.methods.join(" ") || "—"} | ${code(r.file)} | ${list(r.gate)} | ${yn(r.ownerDb)} | ${list(r.tests)} |\n`;
  }
  return md + "\n";
}

function renderAstro(s) {
  const pages = s.rows.filter((r) => r.kind === "page");
  const eps = s.rows.filter((r) => r.kind !== "page");
  let md = `## ${s.label} — \`apps/${s.app}\`\n\n`;
  md += `${pages.length} pages · ${eps.length} endpoints\n\n`;
  md += `### Pages\n\n| URL | what it is | file | layout | src/data | src/lib | locals | set:html | tests |\n|---|---|---|---|---|---|---|---|---|\n`;
  for (const r of pages) {
    md += `| ${code(r.url)} | ${describe(s.app, r)} | ${code(r.file)} | ${list(r.layout)} | ${list(r.data)} | ${list(r.lib)} | ${yn(r.locals)} | ${yn(r.setHtml)} | ${list(r.tests)} |\n`;
  }
  md += `\n### Endpoints\n\n| URL | what it is | methods | file | src/data | src/lib | \`@tokophi/db\` | gate | tests |\n|---|---|---|---|---|---|---|---|---|\n`;
  for (const r of eps) {
    md += `| ${code(r.url)} | ${describe(s.app, r)} | ${r.methods.join(" ") || "—"} | ${code(r.file)} | ${list(r.data)} | ${list(r.lib)} | ${yn(r.db)} | ${list(r.gate)} | ${list(r.tests)} |\n`;
  }
  return md + "\n";
}

// ─── lib inventories (admin / super-admin data + actions modules, with their exports) ───────────
function exportsOf(file) {
  const c = codeOnly(read(file));
  const names = new Set();
  for (const m of c.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of c.matchAll(/export\s+const\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  return [...names].sort();
}
function libRows(dir) {
  const d = join(ROOT, dir);
  if (!existsSync(d)) return [];
  return readdirSync(d)
    .filter((n) => /\.tsx?$/.test(n) && !/\.test\./.test(n))
    .sort()
    .map((n) => ({ module: n, exports: exportsOf(join(d, n)) }));
}
function libTable(dir, title) {
  const rows = libRows(dir);
  if (!rows.length) return "";
  let md = `### ${title} — \`${dir}\`\n\n| module | exports |\n|---|---|\n`;
  for (const r of rows) md += `| ${code(r.module)} | ${r.exports.map(code).join(" ") || "—"} |\n`;
  return md + "\n";
}
const LIB_DIRS = [
  ["apps/admin/lib/data", "Seller reads"],
  ["apps/admin/lib/actions", "Seller writes (server actions)"],
  ["apps/super-admin/lib", "Super Admin lib"],
  ["apps/storefront/src/data", "Storefront data"],
  ["apps/storefront/src/lib", "Storefront lib"],
];

const surfaces = [
  nextSurface("admin", "Seller (merchant panel)"),
  nextSurface("super-admin", "Super Admin (platform control plane)"),
  astroSurface("storefront", "Storefront (multi-tenant shopper site)"),
  astroSurface("landing", "Landing (tokophi.com, static, no DB)"),
  astroSurface("account", "Akun TokoΦ (buyer account + affiliate dashboard, SSR auth)"),
];

let md = `# TokoΦ — PAGE MAP (generated — do not edit by hand)

> **Generated by \`scripts/gen-page-map.mjs\` from the source tree.** Regenerate with
> \`node scripts/gen-page-map.mjs\`; \`test/page-map-fresh.test.ts\` fails when this file is stale.
> This is the page-level index: **which URL is which file, what it reads, what it can write, and
> what gates it.** For the *why*, read \`CODE_MAP.md\` / \`SYSTEM_MAP.md\` / \`FLOWS.md\`; for the
> *state of the numbers on a screen*, \`STATUS.md\`. Findings from the 2026-09-04 sweep that produced
> this map: \`tasks/2026-09-04-page-map-report.md\`. **The same facts as JSON: \`page-map.json\`**
> (written by the same run, checked by the same test) — query that instead of parsing these tables.
>
> Column notes — **gate**: \`cap:<capability>\` = \`requireCapability\` · \`route:<path>\` =
> \`platformRouteGate\` · \`rank:<role>\` = \`platformGate\` · \`session\` = reads the merchant session ·
> \`tenant\` = \`withTenant\`/\`withCurrentTenant\` · \`cron\` · \`public-body\` = \`readPublicBody\` ·
> \`rate-limit\` · \`bot\`. A page's own gate is usually **empty by design**: reads are scoped by
> \`withCurrentTenant\` *inside* \`lib/data/*\`, and writes are gated by \`requireCapability\` *inside*
> \`lib/actions/*\` — so look the module up in the tables at the bottom. **owner \`db\`** = the file
> imports the owner handle directly (the deliberate exceptions are auth, public API, cron, super-admin,
> storefront — see AGENTS.md "TWO POOLS"). **tests** = test files that name the route's directory,
> file or URL (a grep, not a coverage claim). **what it is** = one hand-written line per route from
> \`scripts/page-descriptions.json\` (the generator refuses a route without one, or a line whose route is gone).

`;

checkDescriptions(surfaces);

md += `## Quick find — "I want to change X, where do I go?"\n\n| task | start here |\n|---|---|\n`;
for (const [task, where] of DESCRIPTIONS.howto) md += `| ${task} | ${where} |\n`;
md += `\n(Curated in \`scripts/page-descriptions.json\` next to the per-route "what it is" column — a new page cannot be added without a line there.)\n\n`;

md += `## Totals\n\n| surface | pages | layouts | API/endpoints |\n|---|---|---|---|\n`;
for (const s of surfaces) {
  const pages = s.rows.filter((r) => r.kind === "page").length;
  const layouts = s.rows.filter((r) => r.kind === "layout").length;
  const apis = s.rows.filter((r) => r.kind === "api" || r.kind === "endpoint").length;
  md += `| ${s.label} | ${pages} | ${layouts || "—"} | ${apis} |\n`;
}
md += "\n";

for (const s of surfaces) md += s.app === "storefront" || s.app === "landing" ? renderAstro(s) : renderNext(s);

md += `## Module index (what the pages above import)\n\n`;
for (const [dir, title] of LIB_DIRS) md += libTable(dir, title);

// No timestamp on purpose: the output must be a pure function of the tree, or `--check` is never clean.
const json =
  JSON.stringify(
    {
      $comment: "Generated by scripts/gen-page-map.mjs — do not edit. Human-readable twin: PAGE_MAP.md. Column semantics are in that file's header.",
      surfaces: surfaces.map((s) => ({ app: `apps/${s.app}`, label: s.label, routes: s.rows.map((r) => ({ ...r, whatItIs: describe(s.app, r) })) })),
      modules: Object.fromEntries(LIB_DIRS.map(([dir]) => [dir, libRows(dir)])),
    },
    null,
    2,
  ) + "\n";

if (process.argv.includes("--check")) {
  const stale = [];
  if ((existsSync(OUT) ? read(OUT) : "") !== md) stale.push(rel(OUT));
  if ((existsSync(OUT_JSON) ? read(OUT_JSON) : "") !== json) stale.push(rel(OUT_JSON));
  if (stale.length) {
    console.error(`${stale.join(" + ")} stale — run: node scripts/gen-page-map.mjs`);
    process.exit(1);
  }
  console.log("PAGE_MAP.md + page-map.json are fresh");
} else {
  writeFileSync(OUT, md);
  writeFileSync(OUT_JSON, json);
  console.log(`wrote ${rel(OUT)} + ${rel(OUT_JSON)} — ${surfaces.map((s) => `${s.app}:${s.rows.length}`).join(" · ")}`);
}
