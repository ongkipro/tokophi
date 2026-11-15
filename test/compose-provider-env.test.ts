import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { serviceEnvKeys, sourceFiles } from "./compose-env";

// EVERY PROVIDER VAR A SURFACE READS IS FORWARDED TO IT BY THE PRODUCTION COMPOSE FILE.
//
// Found 2026-11-11: Mengantar shipped (0116) with `MENGANTAR_ENV`, `MENGANTAR_PARTNER_*`,
// `SHIPPING_PROVIDER` and `MENGANTAR_PICKUP_MODE` read by admin and super-admin, and NONE of them in
// docker-compose.coolify.yml. Setting `MENGANTAR_ENV=production` in Coolify — the go-live step every
// doc names — would have changed nothing: the quote reads it as unset (sandbox) and silently keeps the
// default provider, the Kurir switch refuses for the same reason, and nothing says why.
//
// Derived, not listed:
//   · the provider vars = the keys `envVars()` in packages/lib/src/provider-config.ts reads;
//   · an app consumes them when its source imports the provider config, the Mengantar client or the
//     Mengantar account module (directly — `@tokophi/db`'s own loader is reached through those);
//   · plus every `process.env.<PROVIDER_PREFIX>_*` the app's own source reads.
const ROOT = path.resolve(__dirname, "..");
const PROVIDER_CONFIG = readFileSync(path.join(ROOT, "packages/lib/src/provider-config.ts"), "utf8");
const envVarsBody = /const envVars = \(\): ProviderEnvVars => \(\{([\s\S]*?)\}\);/.exec(PROVIDER_CONFIG)?.[1] ?? "";
const PROVIDER_VARS = [...envVarsBody.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]);
const PREFIX = /process\.env\.((?:MENGANTAR|KIRIMINAJA|AUTOLARIS|SHIPPING)_[A-Z0-9_]+)/g;
const CONSUMER = /from\s+["']@tokophi\/(lib\/provider-config|lib\/mengantar|db\/mengantar-account|db\/provider-config)["']|getProviderConfig\(/;

const compose = readFileSync(path.join(ROOT, "docker-compose.coolify.yml"), "utf8");
const apps = readdirSync(path.join(ROOT, "apps")).filter((a) => statSync(path.join(ROOT, "apps", a)).isDirectory());
const needs = new Map<string, Set<string>>();
for (const app of apps) {
  const want = new Set<string>();
  for (const f of sourceFiles(path.join(ROOT, "apps", app))) {
    const src = readFileSync(f, "utf8");
    if (CONSUMER.test(src)) PROVIDER_VARS.forEach((v) => want.add(v));
    for (const m of src.matchAll(PREFIX)) want.add(m[1]);
  }
  if (want.size) needs.set(app, want);
}

describe("production compose forwards every provider var a surface reads", () => {
  it("derives a non-empty var list and both consumers (a scan that matches nothing is green forever)", () => {
    expect(PROVIDER_VARS).toEqual(expect.arrayContaining(["KIRIMINAJA_API_KEY", "MENGANTAR_ENV", "SHIPPING_PROVIDER"]));
    expect([...needs.keys()]).toEqual(expect.arrayContaining(["admin", "super-admin"]));
  });

  it.each([...needs.entries()].map(([app, vars]) => [app, [...vars].sort()] as const))("%s receives %j", (app, vars) => {
    const keys = serviceEnvKeys(compose, app);
    expect(keys, `no top-level service "${app}" in docker-compose.coolify.yml`).not.toBeNull();
    expect(vars.filter((v) => !keys!.has(v)), `forward these in the "${app}" environment block`).toEqual([]);
  });
});
