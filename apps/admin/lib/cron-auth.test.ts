import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { codeOnly } from "../../../test/source-code";
import { cronAuthorized } from "./cron-auth";

/**
 * SEC-16 (Task 4.13) — `CRON_SECRET` travels in a header, and the query transport is GONE.
 *
 * Unlike the payment callback, there is no vendor on this path: we write both the sidecar and the
 * endpoint, so a `?secret=` fallback is purely our own choice. It is the transport every caller used,
 * which is why it had to be removed on BOTH sides in one change — a fallback that still authenticates
 * is a fallback nothing ever migrates off.
 */
const SECRET = "cron-secret-value";
const ROOT = path.resolve(__dirname, "../../..");

const req = (init: { header?: string; query?: string } = {}) =>
  new NextRequest(`http://localhost/api/cron/billing?every=300${init.query ?? ""}`, {
    headers: init.header === undefined ? {} : { "x-cron-secret": init.header },
  });

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("cronAuthorized", () => {
  it("accepts the exact secret in the x-cron-secret header", () => {
    expect(cronAuthorized(req({ header: SECRET }), "cron/billing")).toBe(true);
  });

  it("REFUSES the secret in the query string, however it is spelled", () => {
    expect(cronAuthorized(req({ query: `&secret=${SECRET}` }), "cron/billing")).toBe(false);
    // …and refuses it even when the header is absent and the query value is perfectly correct.
    expect(cronAuthorized(req({ query: `&secret=${encodeURIComponent(SECRET)}` }), "cron/billing")).toBe(false);
  });

  it("says out loud that a query credential was refused, so a stale caller is not just a 401", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    cronAuthorized(req({ query: `&secret=${SECRET}` }), "cron/billing");
    expect(spy.mock.calls.flat().join(" ")).toMatch(/QUERY PARAMETER/);
    // The credential itself is never printed.
    expect(spy.mock.calls.flat().join(" ")).not.toContain(SECRET);
  });

  it("rejects a wrong or missing header", () => {
    expect(cronAuthorized(req({ header: "wrong" }), "cron/billing")).toBe(false);
    expect(cronAuthorized(req({ header: `${SECRET}x` }), "cron/billing")).toBe(false);
    expect(cronAuthorized(req(), "cron/billing")).toBe(false);
  });

  it("FAILS CLOSED in production when CRON_SECRET is unset, and stays open in dev", () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(cronAuthorized(req({ header: "anything" }), "cron/billing")).toBe(false);

    vi.stubEnv("NODE_ENV", "development");
    expect(cronAuthorized(req(), "cron/billing")).toBe(true);
  });

  it("leaves `?every=` alone — it is the sidecar's cadence, not a credential", () => {
    const r = req({ header: SECRET });
    expect(cronAuthorized(r, "cron/billing")).toBe(true);
    expect(r.nextUrl.searchParams.get("every")).toBe("300");
  });
});

/**
 * The CODE of every gated route, and the compose file that calls them. Read together because the
 * defect is only closed when BOTH halves are: a route that still accepts `?secret=` keeps the hole
 * open, and a sidecar that still sends one puts the credential in the process table either way.
 *
 * `codeOnly` because the prose above deliberately writes the retired shape out in full — matching
 * characters would fail on the very comments explaining the fix.
 */
describe("no first-party secret in a cron URL — source scan", () => {
  const GATED = [
    "apps/admin/app/api/cron/billing/route.ts",
    "apps/admin/app/api/cron/tracking/route.ts",
    "apps/admin/app/api/cron/tracking-events/route.ts",
    "apps/admin/app/api/cron/order-expiry/route.ts",
    "apps/admin/app/api/cron/domains/route.ts",
    "apps/admin/app/api/health/env/route.ts",
  ];
  const QUERY_SECRET = /searchParams\s*\.\s*get\s*\(\s*["']secret["']\s*\)/;

  it.each(GATED)("%s reads no credential from the query string and goes through cronAuthorized", (rel) => {
    const code = codeOnly(readFileSync(path.join(ROOT, rel), "utf8"));
    expect(code).not.toMatch(QUERY_SECRET);
    expect(code).toMatch(/cronAuthorized\s*\(/);
  });

  it("the predicate is not vacuous — it fires on a copy with the old fallback put back", () => {
    const mutated = codeOnly(
      `const provided = req.headers.get("x-cron-secret") ?? req.nextUrl.searchParams.get("secret");`,
    );
    expect(mutated).toMatch(QUERY_SECRET);
  });

  const URL_SECRET = /[?&]secret=/;

  it("no compose sidecar puts CRON_SECRET on a URL", () => {
    const compose = readFileSync(path.join(ROOT, "docker-compose.coolify.yml"), "utf8");
    // The sidecar's `command:`, not any line that happens to name the path — one of the comments
    // explaining this very rule mentions `app/api/cron/record-run.ts`.
    const cronCommands = compose
      .split("\n")
      .filter((line) => /^\s*command:/.test(line) && line.includes("/api/cron/"));

    // Six since 2026-09-11: `cron-payment-advice` (observe-only reconciliation). This count is the
    // review gate for a new loop — bump it only after checking the line below passes for the newcomer.
    expect(cronCommands.length).toBe(6);
    for (const line of cronCommands) {
      expect(line).not.toMatch(URL_SECRET);
      expect(line).toContain("x-cron-secret: $$CRON_SECRET");
      // `?every=` is the cadence and must survive: the Sistem panel derives its staleness threshold
      // from it, and hard-coding that number is how a panel starts promising a schedule nobody runs.
      expect(line).toMatch(/[?&]every=\$\$CRON_INTERVAL_SEC/);
    }
  });

  it("that predicate is not vacuous either — the retired sidecar command still matches it", () => {
    expect('wget -qO- "http://admin:3000/api/cron/billing?secret=$$CRON_SECRET&every=$$CRON_INTERVAL_SEC"').toMatch(
      URL_SECRET,
    );
  });
});
