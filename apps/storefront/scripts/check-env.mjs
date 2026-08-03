// ONE invocation contract for every browser check in this folder.
//
// There used to be five. `check-hero-srcset` took `T_URL` and defaulted to port 4374; `check-pdp-srcset`
// took `T_URL` too but wanted a full PDP URL and defaulted to 4392; `check-h1-floor` took `H1_PORT`
// (not `PORT`) plus `DATABASE_URL`; `check-image-widths` needed no server at all. Every one of them was
// individually reasonable and the SET was not runnable: on 2026-08-02 a reviewer started one server,
// ran three of the checks against it and reported **three regressions that did not exist** — the two
// srcset checks had connected to nothing and the third had been pointed at the wrong port.
//
// That is the same family as the alarm this repo has already paid for: `verify-rls` sat red for weeks,
// people learned to scroll past it, and two cross-tenant leaks shipped past a verifier that was already
// failing. A check that is HARD TO RUN CORRECTLY is a check that eventually gets run wrongly, and a
// wrong red costs exactly what a wrong green does — trust in the whole suite.
//
// So there is one knob, and both the runner (`run-checks.mjs`) and a human typing a single check by
// hand set the same one:
//
//   CHECK_BASE_URL   the storefront's origin, tenant included: http://<host>:<port>   (default below)
//   DATABASE_URL     from the environment, as everything else in this repo takes it
//
// A check that needs a specific PAGE derives it from the base URL. It does NOT get its own env var —
// per-script knobs are what this file exists to delete.
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";

// The tenant is resolved from the Host header (ADR 0009), so the HOSTNAME is not cosmetic: it selects
// the store. `toko-demo.test` is the seeded demo store's active primary domain (`store_domains`).
export const DEFAULT_BASE_URL = "http://toko-demo.test:4390";

// ⚠️ A stale invocation must FAIL, never be quietly ignored. Silently running the default while the
// caller believes they aimed somewhere else is precisely the reviewer's three phantom regressions.
const RETIRED = {
  T_URL: "use CHECK_BASE_URL (an ORIGIN, not a page URL)",
  H1_PORT: "use CHECK_BASE_URL (the port is read from it)",
  DPR: "no longer configurable — the checks pin the phone case they were written for",
};
for (const [name, hint] of Object.entries(RETIRED)) {
  if (process.env[name] != null) {
    console.error(`\n${name} is no longer read by these checks — ${hint}.\n`);
    process.exit(1);
  }
}

export const BASE_URL = (process.env.CHECK_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
const parsed = new URL(BASE_URL);
export const HOSTNAME = parsed.hostname;
export const PORT = Number(parsed.port || 80);

/** An absolute URL for a path on the storefront under test. */
export const pageUrl = (path = "/") => `${BASE_URL}${path}`;

/** GET a path from the storefront AS THE TENANT — i.e. with the `Host` header the store is served on.
 *
 *  ⚠️ NOT `fetch`. Undici derives `Host` from the URL and SILENTLY DISCARDS one you pass in `headers`,
 *  so `fetch("http://127.0.0.1:4390/", { headers: { host: "toko-demo.test" } })` arrives as
 *  `Host: 127.0.0.1`, resolves to no store and is answered by the 404 "Toko tidak ditemukan" page —
 *  with a 200-looking `res.ok` nowhere in sight to warn you. Measured 2026-08-03: `curl -H Host` and
 *  `node:http` both got 200 from the same server that returned 404 to `fetch`.
 *
 *  This is not hypothetical tidiness. `check-pixel-defer`'s own "THE DETERMINISTIC CLAIM" — no vendor
 *  `<script src>` in the served HTML — was fetched exactly that way, so for as long as it has existed
 *  it has been counting scripts on the 404 page, where of course there are none. The strongest-worded
 *  assertion in the file was vacuous. `check-h1-floor` used `node:http` and said why; the others did
 *  not, which is what a per-file convention costs. */
export const getAsTenant = (pathname = "/") =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: PORT, path: pathname, headers: { Host: HOSTNAME } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.end();
  });

/** Chromium cannot be given a Host header (it is a forbidden header), so the tenant hostname is made
 *  to resolve to the loopback server instead. Every browser check needs exactly this. */
export const launchChromium = () =>
  chromium.launch({ args: ["--no-sandbox", `--host-resolver-rules=MAP ${HOSTNAME} 127.0.0.1`] });

/** Checks that talk to Postgres take `DATABASE_URL` from the environment, like everything else here.
 *  An explicit env var always wins; failing that we read the same two `.env` files `packages/db`'s
 *  scripts do (`dotenv -e ../../.env -e ../../../../../.env`): the repo root, and — because a worktree
 *  lives at `<main>/.claude/worktrees/<name>` and `.env` is gitignored, so a worktree never has one —
 *  the main checkout's. Named here so the failure is one sentence, not a `postgres()` stack trace. */
export const requireDatabaseUrl = () => {
  const repo = path.join(import.meta.dirname, "..", "..", "..");
  for (const f of [path.join(repo, ".env"), path.join(repo, "..", "..", "..", ".env")]) {
    if (process.env.DATABASE_URL) break;
    try { process.loadEnvFile(f); } catch { /* absent, or unreadable — the next one, then the message */ }
  }
  if (!process.env.DATABASE_URL) {
    console.error("\nDATABASE_URL is not set, and no .env was found at the repo root or the main checkout.");
    console.error("This check reads (and, for check-h1-floor, briefly writes) the dev database.\n");
    process.exit(1);
  }
  return process.env.DATABASE_URL;
};

/** The exit code that means "this check does not APPLY to the data it was pointed at" — as distinct
 *  from 0 (the claim holds) and 1 (the claim is broken). The runner renders it as SKIP, prints the
 *  reason, and does not fail the suite on it. See run-checks.mjs for why that third state exists. */
export const NOT_APPLICABLE = 2;
