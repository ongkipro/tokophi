import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { serviceEnvKeys, sourceFiles } from "./compose-env";
import { HEALTH_PATH } from "../apps/affiliate/src/lib/availability";

// AFFILIATE TOKOΦ REACHES PRODUCTION WIRED, AND TURNING IT ON IS COOLIFY ENV ONLY (AFFILIATE-P2, ADR 0022).
//
// Same contract as compose-account.test.ts: the app ships dormant, and a var set in Coolify reaches a
// container only if that service's block forwards it. Derived from source, not listed — a new env read in
// apps/affiliate goes red here until it is forwarded.
const ROOT = path.resolve(__dirname, "..");
const compose = readFileSync(path.join(ROOT, "docker-compose.coolify.yml"), "utf8");
const dockerfile = readFileSync(path.join(ROOT, "apps/affiliate/Dockerfile"), "utf8");
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

const SRC = sourceFiles(path.join(ROOT, "apps/affiliate/src"));
const CONFIG = read(path.join(ROOT, "apps/affiliate/astro.config.mjs"));
const configList = /for \(const key of \[([^\]]*)\]\)/.exec(CONFIG)?.[1] ?? "";
const reads = new Set<string>([
  ...SRC.flatMap((f) => [...read(f).matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)].map((m) => m[1])),
  ...[...configList.matchAll(/"([A-Z][A-Z0-9_]*)"/g)].map((m) => m[1]),
]);

describe("docker-compose.coolify.yml — the affiliate service", () => {
  const env = serviceEnvKeys(compose, "affiliate");
  const lines = serviceLines("affiliate");
  const port = /^EXPOSE (\d+)$/m.exec(dockerfile)?.[1];

  it("exists, built from apps/affiliate/Dockerfile", () => {
    expect(env, 'no top-level service "affiliate"').not.toBeNull();
    expect(lines.join("\n")).toMatch(/dockerfile: apps\/affiliate\/Dockerfile/);
  });

  it("derives a non-empty list of what the app reads (a scan that matches nothing is green forever)", () => {
    expect([...reads]).toEqual(expect.arrayContaining(["DATABASE_URL", "AFFILIATE_APP_URL", "STOREFRONT_BASE_DOMAIN"]));
  });

  it("forwards every var the app reads", () => {
    const missing = [...reads].filter((v) => v !== "NODE_ENV" && !env!.has(v));
    expect(missing, "forward these in the affiliate environment block").toEqual([]);
    expect(env!.has("DATABASE_RUNTIME_ROLE")).toBe(true);
  });

  it("keeps THE switch EMPTY by default (dormant until the owner sets it)", () => {
    expect(lines.join("\n")).toMatch(/AFFILIATE_APP_URL: \$\{AFFILIATE_APP_URL:-\}/);
  });

  it("is routed on affiliate.tokophi.com ABOVE the store wildcard, to the port the image listens on", () => {
    expect(label(lines, "traefik.http.routers.tokophi-affiliate.rule")).toBe("Host(`affiliate.tokophi.com`)");
    const wildcard = Number(label(serviceLines("storefront"), "traefik.http.routers.tokophi-stores.priority"));
    expect(Number(label(lines, "traefik.http.routers.tokophi-affiliate.priority"))).toBeGreaterThan(wildcard);
    expect(label(lines, "traefik.http.routers.tokophi-affiliate.tls")).toBe("true");
    expect(port).toBeDefined();
    expect(dockerfile).toMatch(new RegExp(`PORT=${port}\\b`));
    expect(label(lines, "traefik.http.services.tokophi-affiliate.loadbalancer.server.port")).toBe(port);
    expect(lines.join("\n")).toMatch(new RegExp(`- "${port}"`));
  });

  it("health-checks the path that answers while closed, on 127.0.0.1, with the ADR 0017 start_interval", () => {
    const block = lines.join("\n");
    expect(block).toContain(`http://127.0.0.1:${port}${HEALTH_PATH}`);
    expect(block).toMatch(/start_interval: 2s/);
    expect(block).not.toMatch(/migrate:/);
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
      for (const m of read(f).matchAll(/process\.env\.(AFFILIATE_[A-Z0-9_]+)/g)) vars.add(m[1]);
    }
    if (vars.size) want.set(app, vars);
  }

  it("finds admin (invite links) and storefront (the join link)", () => {
    expect(want.get("admin")).toContain("AFFILIATE_APP_URL");
    expect(want.get("storefront")).toContain("AFFILIATE_APP_URL");
  });

  it.each([...want.entries()].map(([app, vars]) => [app, [...vars].sort()] as const))("%s receives %j", (app, vars) => {
    const keys = serviceEnvKeys(compose, app);
    expect(keys, `no top-level service "${app}"`).not.toBeNull();
    expect(vars.filter((v) => !keys!.has(v))).toEqual([]);
  });
});
