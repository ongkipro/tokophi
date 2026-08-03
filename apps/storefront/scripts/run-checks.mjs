// The storefront's browser-check SUITE. One server, started once, every check run against it with the
// right environment, one table at the end and an exit code that means what it says.
//
//   npm run verify -w @tokophi/storefront          # from the repo root
//   npm run verify -w @tokophi/storefront -- --no-build
//
// ── WHY THIS EXISTS ───────────────────────────────────────────────────────────────────────────────
//
// Each check in this folder had invented its own invocation: two different meanings of `T_URL`, an
// `H1_PORT` that was not `PORT`, and four different default ports (4373 / 4374 / 4392 / none). Every
// one of them was locally reasonable, and the SET was not runnable. On 2026-08-02 a reviewer started
// one server, pointed three checks at it and reported **three regressions that did not exist**.
//
// That is not a documentation problem. A check that is hard to run correctly is a check that
// eventually gets run wrongly — and this repo has already paid the bill for the mirror image of it:
// `verify-rls` sat red for weeks, everybody learned to scroll past it, and two cross-tenant leaks
// shipped past a verifier that was already failing. A wrong red costs what a wrong green costs.
//
// So the per-script conventions were CONVERGED (see check-env.mjs), not wrapped: a wrapper that papers
// over five conventions leaves five conventions, and the next person to run one by hand still meets
// them. There is now one `CHECK_BASE_URL`, `DATABASE_URL` from the environment like everything else in
// this repo, and this file, which sets both.
//
// ── THE THREE RESULTS, AND WHY THERE ARE THREE ────────────────────────────────────────────────────
//
//   PASS (0)  the claim holds.
//   FAIL (1)  the claim is broken. The suite exits non-zero. This is the only state that means "code".
//   SKIP (2)  the check does not APPLY to the data it was pointed at.
//
// SKIP earns its place because of `check-pixel-defer`. It asserted that all three ad vendors load,
// while the seeded store has exactly one channel enabled — so it was red on clean `main`, for every
// change set, forever. Reporting that as a failure teaches people to ignore the whole suite; hiding it
// is worse, because then nobody knows the coverage is missing. Neither was necessary: the check now
// reads the enabled channels out of `store_tracking_channels` and asserts the claim that was always
// meant — every channel THIS TENANT switched on is stubbed, buffers, and loads on interaction — so on
// the seeded data it is green for a real reason. SKIP is what remains for the genuinely vacuous case
// (a tenant with no channels at all): printed loudly with its reason on every run, never counted as a
// pass, never counted as a code failure.
//
// ── THE SERVER ────────────────────────────────────────────────────────────────────────────────────
//
// ⚠️ Other agents run servers on this machine. This file NEVER uses `pkill`, and it signals ONLY the
// process group it spawned itself — including when a check throws, and on Ctrl-C. A port that is
// already taken fails immediately with the port number in the message; it must never hang, and it must
// never silently run the suite against somebody else's server.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { BASE_URL, HOSTNAME, PORT, getAsTenant, requireDatabaseUrl } from "./check-env.mjs";

const ROOT = path.join(import.meta.dirname, "..");
const ENTRY = path.join(ROOT, "dist", "server", "entry.mjs");
const argv = process.argv.slice(2);

// `server: false` = disk versus disk, so it runs with nothing listening and cannot flake.
// Cheapest first, and `check-h1-floor` last because it briefly stages a row in the shared dev DB.
const CHECKS = [
  { name: "check-image-widths", server: false },
  { name: "check-hero-srcset", server: true },
  { name: "check-pdp-srcset", server: true },
  { name: "check-pixel-defer", server: true },
  { name: "check-h1-floor", server: true },
];

const DATABASE_URL = requireDatabaseUrl();
const log = (s = "") => console.log(s);

/** Fail loudly on a busy port. Binding is the only honest test — `ss` output is a guess about who
 *  would answer, and a check pointed at a stranger's server produces confident nonsense. */
const portIsFree = () =>
  new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(PORT, "127.0.0.1");
  });

/** Build when there is no build, or when anything it is made of is newer than it. */
const needsBuild = () => {
  if (!existsSync(ENTRY)) return "no dist/server/entry.mjs";
  const newer = spawnSync(
    "find",
    ["src", "public", "astro.config.mjs", "package.json", "../../packages",
     "-name", "node_modules", "-prune", "-o", "-type", "f", "-newer", ENTRY, "-print", "-quit"],
    { cwd: ROOT, encoding: "utf8" },
  );
  const hit = (newer.stdout || "").trim();
  return hit ? `${hit} is newer than the build` : null;
};

const run = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    const c = spawn(cmd, args, { stdio: "inherit", ...opts });
    c.on("close", (code, signal) => resolve(signal ? 1 : (code ?? 1)));
  });

// ── the server, and the ONE pid this process is allowed to signal ─────────────────────────────────
let server = null;
const serverLog = [];

const stopServer = () => {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  const pid = server.pid;
  server = null;
  // Spawned `detached`, so it owns a process group and `-pid` reaches it and nothing else. Never a
  // name match: `pkill -f "entry.mjs"` would take out every other agent's storefront too.
  try { process.kill(-pid, "SIGTERM"); } catch { /* already gone */ }
  setTimeout(() => { try { process.kill(-pid, "SIGKILL"); } catch { /* already gone */ } }, 3000).unref();
};

const startServer = async () => {
  if (!(await portIsFree())) {
    log(`\nPort ${PORT} is already in use.`);
    log(`Something is listening on it — very possibly another agent's server, which this suite must`);
    log(`not run against and must not kill. Find it with:  ss -ltnp 'sport = :${PORT}'`);
    log(`Then either stop it, or point this run somewhere else:`);
    log(`  CHECK_BASE_URL=http://${HOSTNAME}:<free-port> npm run verify -w @tokophi/storefront\n`);
    process.exit(1);
  }

  server = spawn(process.execPath, [ENTRY], {
    cwd: ROOT,
    detached: true, // its own process group — see stopServer()
    env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1", DATABASE_URL },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const keep = (b) => serverLog.push(String(b).trimEnd());
  server.stdout.on("data", keep);
  server.stderr.on("data", keep);
  let died = null;
  server.on("exit", (code, sig) => { died = `exited ${sig ?? code}`; });

  // Wait for READINESS, never a sleep: a fixed sleep is either slower than it needs to be or a race,
  // and the race shows up as a check reporting a regression that is really a connection refused.
  // 200 specifically, not "any response": the tenant is resolved from the Host header, so a 404 means
  // the server is up and `CHECK_BASE_URL`'s hostname matches no store — every check would then be
  // measuring the "Toko tidak ditemukan" page and reporting confident nonsense about it.
  const deadline = Date.now() + 60_000;
  let last = "no response yet";
  for (;;) {
    if (died) {
      log(`\nThe storefront server ${died} before it was ready:\n`);
      log(serverLog.join("\n"));
      process.exit(1);
    }
    try {
      const res = await getAsTenant("/"); // node:http — `fetch` cannot send a Host header, see check-env.mjs
      last = `HTTP ${res.status}`;
      if (res.status === 200) break;
    } catch (e) { last = String(e.code || e.message); }
    if (Date.now() > deadline) {
      log(`\nThe storefront never served a 200 for Host "${HOSTNAME}" on port ${PORT} within 60 s (last: ${last}).`);
      log(`If that host resolves to no store, no check below could have meant anything.\n`);
      log(serverLog.join("\n"));
      stopServer();
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
};

// A check that throws, a Ctrl-C, an uncaught error: the server still dies with us, and only it.
process.on("exit", stopServer);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { stopServer(); process.exit(130); });

// ── run ───────────────────────────────────────────────────────────────────────────────────────────
if (!argv.includes("--no-build")) {
  const why = needsBuild();
  if (why) {
    log(`▸ building the storefront (${why})`);
    const code = await run("npx", ["astro", "build"], { cwd: ROOT });
    if (code !== 0) { log("\nThe build failed — nothing below would have meant anything.\n"); process.exit(code); }
  } else {
    log("▸ build is up to date");
  }
}

if (CHECKS.some((c) => c.server)) {
  await startServer();
  log(`▸ storefront on ${BASE_URL} (pid ${server.pid}) — this run's server, and the only one it will signal`);
}

const results = [];
for (const c of CHECKS) {
  log(`\n──── ${c.name} ${"─".repeat(Math.max(0, 74 - c.name.length))}`);
  const t = Date.now();
  const code = await run(process.execPath, [path.join(import.meta.dirname, `${c.name}.mjs`)], {
    cwd: ROOT,
    env: { ...process.env, CHECK_BASE_URL: BASE_URL, DATABASE_URL },
  });
  results.push({ name: c.name, code, ms: Date.now() - t });
}

stopServer();

const LABEL = { 0: "PASS", 2: "SKIP" };
const failed = results.filter((r) => r.code !== 0 && r.code !== 2);
const skipped = results.filter((r) => r.code === 2);

log(`\n┌─${"─".repeat(24)}┬────────┬─────────┐`);
log(`│ ${"check".padEnd(24)}│ result │    time │`);
log(`├─${"─".repeat(24)}┼────────┼─────────┤`);
for (const r of results) {
  log(`│ ${r.name.padEnd(24)}│ ${(LABEL[r.code] ?? "FAIL").padEnd(7)}│ ${`${(r.ms / 1000).toFixed(1)}s`.padStart(7)} │`);
}
log(`└─${"─".repeat(24)}┴────────┴─────────┘`);

if (skipped.length) log(`\n${skipped.length} skipped — NOT a pass. Scroll up for the reason; it is data, not code.`);
log(failed.length ? `\n${failed.length} of ${results.length} checks FAILED: ${failed.map((r) => r.name).join(", ")}\n` : `\nall ${results.length} checks green\n`);
process.exit(failed.length ? 1 : 0);
