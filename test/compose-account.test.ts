import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { serviceEnvKeys, sourceFiles } from "./compose-env";
import { HEALTH_PATH } from "../apps/account/src/lib/availability";

// AKUN TOKOΦ REACHES PRODUCTION WIRED, AND TURNING IT ON IS COOLIFY ENV ONLY (BUYER-ACCOUNT-DEPLOY).
//
// The account app (ADR 0016) ships dormant: a var set in Coolify reaches a container only if that
// service's block forwards it (the SIGNUP_ENABLED / AUTH_SECRET / MENGANTAR lessons), so the day the
// owner sets the Google client and the claim secret, every half of the feature must already be listening.
// Derived from source, not listed — a new env read in apps/account goes red here until it is forwarded.
const ROOT = path.resolve(__dirname, "..");
const compose = readFileSync(path.join(ROOT, "docker-compose.coolify.yml"), "utf8");
const dockerfile = readFileSync(path.join(ROOT, "apps/account/Dockerfile"), "utf8");
const read = (f: string) => readFileSync(f, "utf8");

/** The raw lines of one top-level service (comments kept out). */
function serviceLines(service: string): string[] {
  const lines = compose.split("\n");
  const start = lines.findIndex((l) => l === `  ${service}:`);
  if (start < 0) return [];
  const out: string[] = [];
  for (let i = start + 1; i < lines.length && !/^ {2}\S/.test(lines[i]) && !/^\S/.test(lines[i]); i++) {
    if (!/^\s*#/.test(lines[i])) out.push(lines[i]);
  }
  return out;
}
const label = (lines: string[], key: string) =>
  lines.map((l) => new RegExp(`^\\s*- ${key.replace(/\./g, "\\.")}=(.*)$`).exec(l)?.[1]).find(Boolean);

// What the account app reads at runtime: its own `process.env.X`, the vars astro.config surfaces for
// `astro dev` (the list of runtime vars this app documents), and the ones the shared libs it imports read.
const ACCOUNT_SRC = sourceFiles(path.join(ROOT, "apps/account/src"));
const CONFIG = read(path.join(ROOT, "apps/account/astro.config.mjs"));
const configList = /for \(const key of \[([^\]]*)\]\)/.exec(CONFIG)?.[1] ?? "";
const reads = new Set<string>([
  ...ACCOUNT_SRC.flatMap((f) => [...read(f).matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)].map((m) => m[1])),
  ...[...configList.matchAll(/"([A-Z][A-Z0-9_]*)"/g)].map((m) => m[1]),
]);
// Named exceptions — each says why the var is deliberately NOT forwarded to the account container.
const NOT_FORWARDED: Record<string, string> = {
  PUBLIC_ONGKIR_API:
    "fallback in data/orders.ts mediaUrl() for the Seller (admin) origin, borrowed from the storefront's naming; the account service gets ADMIN_URL, which wins",
};

describe("docker-compose.coolify.yml — the account service", () => {
  const env = serviceEnvKeys(compose, "account");
  const lines = serviceLines("account");
  const port = /^EXPOSE (\d+)$/m.exec(dockerfile)?.[1];

  it("exists, built from apps/account/Dockerfile", () => {
    expect(env, 'no top-level service "account"').not.toBeNull();
    expect(lines.join("\n")).toMatch(/dockerfile: apps\/account\/Dockerfile/);
  });

  it("derives a non-empty list of what the app reads (a scan that matches nothing is green forever)", () => {
    expect([...reads]).toEqual(expect.arrayContaining(["DATABASE_URL", "AUTH_SECRET", "ACCOUNT_CLAIM_SECRET", "GOOGLE_CLIENT_ID", "ACCOUNT_GOOGLE_REDIRECT_URI"]));
  });

  it("forwards every var the app reads, except the named ones", () => {
    const missing = [...reads].filter((v) => !(v in NOT_FORWARDED) && v !== "NODE_ENV" && !env!.has(v));
    expect(missing, "forward these in the account environment block").toEqual([]);
    // DATABASE_RUNTIME_ROLE: `@tokophi/db` defaults a production process to the restricted role.
    expect(env!.has("DATABASE_RUNTIME_ROLE")).toBe(true);
  });

  it("requires AUTH_SECRET and keeps the switches EMPTY by default (dormant until the owner sets them)", () => {
    const block = lines.join("\n");
    expect(block).toMatch(/AUTH_SECRET: \$\{AUTH_SECRET:\?/);
    for (const v of ["ACCOUNT_CLAIM_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]) {
      expect(block, v).toMatch(new RegExp(`${v}: \\$\\{${v}:-\\}`));
    }
    expect(block).toMatch(/ACCOUNT_GOOGLE_REDIRECT_URI: \$\{ACCOUNT_GOOGLE_REDIRECT_URI:-https:\/\/account\.tokophi\.com\/auth\/google\/callback\}/);
  });

  it("is routed on account.tokophi.com ABOVE the store wildcard, to the port the image listens on", () => {
    expect(label(lines, "traefik.http.routers.tokophi-account.rule")).toBe("Host(`account.tokophi.com`)");
    const wildcard = Number(label(serviceLines("storefront"), "traefik.http.routers.tokophi-stores.priority"));
    expect(Number(label(lines, "traefik.http.routers.tokophi-account.priority"))).toBeGreaterThan(wildcard);
    expect(label(lines, "traefik.http.routers.tokophi-account.tls")).toBe("true");
    expect(port).toBeDefined();
    expect(dockerfile).toMatch(new RegExp(`PORT=${port}\\b`));
    expect(label(lines, "traefik.http.services.tokophi-account.loadbalancer.server.port")).toBe(port);
    expect(lines.join("\n")).toMatch(new RegExp(`- "${port}"`));
  });

  it("health-checks the path that answers while closed, on 127.0.0.1, with the ADR 0017 start_interval", () => {
    const block = lines.join("\n");
    expect(block).toContain(`http://127.0.0.1:${port}${HEALTH_PATH}`);
    expect(block).toMatch(/start_interval: 2s/);
    expect(block).not.toMatch(/migrate:/); // postgres only — no migrate gate (ADR 0017 §2.4)
  });

  it("runs as a non-root user", () => {
    expect(dockerfile).toMatch(/^USER node$/m);
  });
});

describe("the other halves of the switch are forwarded too", () => {
  const apps = readdirSync(path.join(ROOT, "apps")).filter((a) => statSync(path.join(ROOT, "apps", a)).isDirectory());
  const want = new Map<string, Set<string>>();
  for (const app of apps) {
    const vars = new Set<string>();
    for (const f of sourceFiles(path.join(ROOT, "apps", app))) {
      const src = read(f);
      if (/from\s+["']@tokophi\/lib\/claim-token["']/.test(src)) vars.add("ACCOUNT_CLAIM_SECRET");
      for (const m of src.matchAll(/process\.env\.(ACCOUNT_[A-Z0-9_]+)/g)) vars.add(m[1]);
    }
    if (vars.size) want.set(app, vars);
  }

  it("finds admin (claim tokens) and storefront (the offer link)", () => {
    expect(want.get("admin")).toContain("ACCOUNT_CLAIM_SECRET");
    expect(want.get("storefront")).toContain("ACCOUNT_APP_URL");
  });

  it.each([...want.entries()].map(([app, vars]) => [app, [...vars].sort()] as const))("%s receives %j", (app, vars) => {
    const keys = serviceEnvKeys(compose, app);
    expect(keys, `no top-level service "${app}"`).not.toBeNull();
    expect(vars.filter((v) => !keys!.has(v))).toEqual([]);
  });
});
