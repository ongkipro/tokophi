import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("./audit-responsive.mjs", import.meta.url));
const PLAYWRIGHT_STUB = fileURLToPath(
  new URL("./test-stubs/audit-responsive-playwright.mjs", import.meta.url),
);

function runAudit(credentials: Partial<Record<"AUDIT_EMAIL" | "AUDIT_PASSWORD", string>>) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AUDIT_EMAIL: "audit@example.test",
    AUDIT_PASSWORD: "local-test-password",
    ...credentials,
    NODE_OPTIONS: `--import="${PLAYWRIGHT_STUB}"`,
  };
  for (const [name, value] of Object.entries(credentials)) {
    if (value === undefined) delete env[name as keyof typeof env];
  }
  return spawnSync(process.execPath, [SCRIPT, "http://audit.example.test"], {
    encoding: "utf8",
    env,
  });
}

describe("responsive audit credentials", () => {
  it.each(["AUDIT_EMAIL", "AUDIT_PASSWORD"] as const)(
    "fails before launching a browser when %s is absent",
    (missing) => {
      const result = runAudit({ [missing]: undefined });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("AUDIT_EMAIL and AUDIT_PASSWORD must be set");
      expect(result.stderr).not.toContain("browser launched");
    },
  );

  it("uses explicit credentials for the login flow", () => {
    const result = runAudit({});

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("OK — 264 route×width combinations");
  });
});
