import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { codeOfFile, codeOnly, isTestFile, trackedSources } from "../../../../test/source-code";

// CSP-CONNECT (2026-11-13). On production toko.tokophi.com/checkout the browser logged
//   "Connecting to 'https://app.tokophi.com/api/public/ongkir' violates … connect-src … report-only"
// because the storefront policy listed only the shop's own origin while the checkout fetches the
// Seller app's public API. Report-only = a console line; ENFORCED = no rates, no COD, no order.
//
// Two halves, and the fix needs both:
//   1. BEHAVIOUR — the policy the middleware sets lists the origin of every URL the client is handed,
//      for whatever env the container runs with (prod `app.tokophi.com`, dev `localhost:3000`).
//   2. WIRING — that is only true if every cross-origin `fetch()` on a shopper page goes through
//      `lib/public-api.ts`, and the middleware sets the policy built THERE. A page that grows its own
//      `const X_API = process.env…` would fetch an origin no policy lists, with every test above green.

const ENV = ["PUBLIC_ONGKIR_API", "PUBLIC_ORDER_API"] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  vi.resetModules(); // public-api.ts reads env at module load
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const connectSrc = (policy: string) => (policy.split("; ").find((d) => d.startsWith("connect-src ")) ?? "").split(" ");

/** The module under test. `PUBLIC_API_MODULE` lets the mutation proof point this at a broken COPY. */
const load = () => import(/* @vite-ignore */ process.env.PUBLIC_API_MODULE ?? "./public-api");

describe("storefront CSP connect-src ⊇ the origins the checkout fetches", () => {
  it("production: ongkir, order and promo origins are all listed (different hosts too)", async () => {
    process.env.PUBLIC_ONGKIR_API = "https://app.tokophi.com/api/public/ongkir";
    process.env.PUBLIC_ORDER_API = "https://api2.tokophi.test/api/public/order";
    const m = await load();
    const listed = connectSrc(m.STOREFRONT_CSP);
    for (const url of [m.ONGKIR_API, m.ORDER_API, m.PROMO_API]) expect(listed).toContain(new URL(url).origin);
    expect(listed).toContain("https://app.tokophi.com");
    expect(listed).toContain("https://api2.tokophi.test");
  });

  it("dev (no env): the localhost:3000 default the client falls back to is listed", async () => {
    for (const k of ENV) delete process.env[k];
    const m = await load();
    expect(new URL(m.ORDER_API).origin).toBe("http://localhost:3000");
    expect(connectSrc(m.STOREFRONT_CSP)).toContain("http://localhost:3000");
  });

  it("CLIENT_API_URLS names every exported endpoint (a new one cannot skip the policy)", async () => {
    const m = await load();
    const endpoints = Object.entries(m).filter(([k]) => /_API$/.test(k)).map(([, v]) => v);
    expect([...m.CLIENT_API_URLS].sort()).toEqual([...endpoints].sort());
  });
});


// ── wiring (source guard — codeOnly, so a commented-out line cannot satisfy it) ─────────────────────

const STOREFRONT_SOURCES = trackedSources().filter((f) => f.startsWith("apps/storefront/src/") && !isTestFile(f));
const PUBLIC_API_NAMES = new Set(["ONGKIR_API", "ORDER_API", "PROMO_API"]);
// Named exception: checkout.astro's abandoned-cart capture holds a SAME-origin path in a variable.
// Pinned below to stay a "/…" literal, so it can never turn into a cross-origin target unseen.
const SAME_ORIGIN_VARS = new Set(["CAPTURE_API"]);
// `fetch(x` / `sendBeacon(x` — the first token of the first argument.
const CALL = /\b(?:fetch|sendBeacon)\s*\(\s*([^\s,)]+)/g;
const IMPORTS_PUBLIC_API = /\bfrom\s*"(?:\.\.?\/)+(?:lib\/)?public-api"/;

/** Why `code` (codeOnly output) could fetch an origin the storefront CSP does not list. */
function violations(code: string): string[] {
  const out: string[] = [];
  for (const [, arg] of code.matchAll(CALL)) {
    if (arg.startsWith('"/') && !arg.startsWith('"//')) continue; // relative path → 'self'
    if (SAME_ORIGIN_VARS.has(arg)) {
      if (!new RegExp(`\\b${arg}\\s*=\\s*"/[^/]`).test(code)) out.push(`${arg} is no longer a same-origin "/…" literal`);
      continue;
    }
    if (!PUBLIC_API_NAMES.has(arg)) out.push(`fetch target ${arg} is neither a same-origin path nor a lib/public-api.ts export`);
    else if (!IMPORTS_PUBLIC_API.test(code)) out.push(`${arg} is not imported from lib/public-api.ts`);
    else if (new RegExp(`\\b(?:const|let|var)\\s+${arg}\\s*=`).test(code)) out.push(`${arg} is redefined locally`);
  }
  return out;
}

describe("every client fetch target is same-origin or comes from lib/public-api.ts", () => {
  it("scans a non-empty set (the guard is not vacuous)", () => {
    expect(STOREFRONT_SOURCES.flatMap((f) => [...codeOfFile(f).matchAll(CALL)]).length).toBeGreaterThan(5);
  });

  it.each(STOREFRONT_SOURCES)("%s", (file) => {
    expect(violations(codeOfFile(file)), "the storefront CSP would not list this origin").toEqual([]);
  });

  it("mutation self-check: the guard goes red on broken copies of checkout.astro", () => {
    const src = readFileSync(new URL("../pages/checkout.astro", import.meta.url), "utf8");
    expect(violations(codeOnly(src))).toEqual([]);
    const mutants = {
      "own env read": src.replace(/import \{ ONGKIR_API, ORDER_API, PROMO_API \} from "\.\.\/lib\/public-api";/, 'const ORDER_API = process.env.PUBLIC_ORDER_API || "x"; const ONGKIR_API = ORDER_API; const PROMO_API = ORDER_API;'),
      "hard-coded host": src.replace(/fetch\(ORDER_API,/, 'fetch("https://app.tokophi.com/api/public/order",'),
      "protocol-relative": src.replace(/fetch\(PROMO_API,/, 'fetch("//app.tokophi.com/api/public/promo",'),
      "capture goes cross-origin": src.replace(/var CAPTURE_API = "\/api\/checkout-session"/, 'var CAPTURE_API = "https://x.test/c"'),
    };
    for (const [name, m] of Object.entries(mutants)) {
      expect(m, `mutant "${name}" did not apply`).not.toBe(src);
      expect(violations(codeOnly(m)), name).not.toEqual([]);
    }
  });

  it("the middleware sets the policy built in lib/public-api.ts — and nothing builds a second one", () => {
    const mw = codeOfFile("apps/storefront/src/middleware.ts");
    expect(mw).toMatch(/import\s*\{\s*STOREFRONT_CSP\s*\}\s*from\s*"\.\/lib\/public-api"/);
    expect(mw).toMatch(/\.\s*set\s*\(\s*CSP_REPORT_ONLY_HEADER\s*,\s*STOREFRONT_CSP\s*\)/);
    const builders = STOREFRONT_SOURCES.filter((f) => /\bstorefrontCspReportOnly\s*\(/.test(codeOfFile(f)));
    expect(builders).toEqual(["apps/storefront/src/lib/public-api.ts"]);
  });
});
