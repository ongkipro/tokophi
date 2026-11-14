import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { serviceEnvKeys, sourceFiles } from "./compose-env";

// EVERY SURFACE THAT USES THE SIGNING SECRET IS HANDED IT BY THE PRODUCTION COMPOSE FILE.
//
// Found 2026-10-29: `docker-compose.coolify.yml` forwarded `AUTH_SECRET` to admin and super-admin only.
// The storefront signs/verifies the abandoned-cart recovery link (`@tokophi/lib/recovery`) and the chat
// visitor token (`src/lib/chat.ts`) with it, and `authSecret()` THROWS in production when it is unset.
// `verifyRecoveryToken` swallows that throw by design, so every WhatsApp recovery link silently opened
// an empty checkout — nothing logged, build and typecheck green. A var set in Coolify reaches a
// container only if its block forwards it, so this reads the blocks, not the Coolify UI.
//
// Derived, not listed: an app counts as a consumer when any of its source files imports the secret
// (`@tokophi/lib/secret`) or the recovery token module that reads it. Compose service = app dir name.
const ROOT = path.resolve(__dirname, "..");
const CONSUMER = /from\s+["']@tokophi\/lib\/(secret|recovery)["']/;

describe("production compose forwards AUTH_SECRET to every surface that signs with it", () => {
  const compose = readFileSync(path.join(ROOT, "docker-compose.coolify.yml"), "utf8");
  const apps = readdirSync(path.join(ROOT, "apps")).filter((a) => statSync(path.join(ROOT, "apps", a)).isDirectory());
  const consumers = apps.filter((a) => sourceFiles(path.join(ROOT, "apps", a)).some((f) => CONSUMER.test(readFileSync(f, "utf8"))));

  it("finds the consumers (a scan that matches nothing is green forever)", () => {
    expect(consumers).toEqual(expect.arrayContaining(["admin", "super-admin", "storefront"]));
  });

  // NAMED exceptions: a surface that is in the repo but NOT deployed has no compose block to forward to.
  // Each entry must stay true — the moment the app gets a Dockerfile (the step before a compose service)
  // the exception goes red and forces the AUTH_SECRET line to be written in the same change.
  const NOT_DEPLOYED: Record<string, string> = {
    account: "TokoΦ Account (ADR 0016) — merged dark; production enablement (container, DNS, secrets) is owner-gated",
  };
  it.each(Object.keys(NOT_DEPLOYED))("%s is listed as not deployed and really has no Dockerfile", (app) => {
    expect(existsSync(path.join(ROOT, "apps", app, "Dockerfile")), NOT_DEPLOYED[app]).toBe(false);
    expect(serviceEnvKeys(compose, app)).toBeNull();
  });

  it.each(consumers.filter((a) => !(a in NOT_DEPLOYED)))("%s receives AUTH_SECRET", (app) => {
    const keys = serviceEnvKeys(compose, app);
    expect(keys, `no top-level service "${app}" in docker-compose.coolify.yml`).not.toBeNull();
    expect([...keys!]).toContain("AUTH_SECRET");
  });
});
