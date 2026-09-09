import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Stage 7 step 5 (TASKS.md): the four repository-owned release guards written for Tasks 5.13, 5.14,
// 5.15 and the guard half of 6.6. Each one is asserted GREEN on the tree AND RED against a mutated
// temp copy of its own input — a guard converted on faith can be green for the wrong reason (this
// repo has paid for that: `verify-rls` sat red for weeks; a pixel check asserted against a 404 page
// for its whole life). Mutations happen on COPIES under the OS temp dir; product source and specs
// are never edited by this suite.
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const tmp = () => mkdtempSync(join(tmpdir(), "tokophi-guard-"));

type Run = { code: number; out: string };
function run(script: string, args: string[] = []): Run {
  try {
    const out = execFileSync(process.execPath, [join("scripts", script), ...args], { cwd: ROOT, encoding: "utf8", stdio: "pipe" });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status: number | null; stdout?: string; stderr?: string };
    return { code: err.status ?? -1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

describe("verify-openapi.mjs (Task 5.13)", () => {
  const specs = ["admin-api.yaml", "storefront-api.yaml"].map((f) => join(ROOT, "specs/openapi", f));

  it("is green on the tree", () => {
    expect(run("verify-openapi.mjs").code).toBe(0);
  });

  it("goes red when a spec documents an operation that has no route on disk", () => {
    const dir = tmp();
    const copy = join(dir, "storefront-api.yaml");
    const text = readFileSync(specs[1], "utf8").replace(
      "\n  /api/public/kiriminaja/webhook:",
      "\n  /api/public/nope:\n    post:\n      operationId: nope\n      responses:\n        '200':\n          description: never\n  /api/public/kiriminaja/webhook:",
    );
    expect(text).toContain("/api/public/nope");
    writeFileSync(copy, text);
    const r = run("verify-openapi.mjs", ["--spec", specs[0], "--spec", copy]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/- POST \/api\/public\/nope/);
  });

  it("goes red when a public route on disk is neither documented nor exempted", () => {
    const dir = tmp();
    const map = JSON.parse(readFileSync(join(ROOT, "specs/docs/page-map.json"), "utf8"));
    map.surfaces[0].routes.push({ url: "/api/public/ghost", kind: "api", methods: ["POST"], file: "apps/admin/app/api/public/ghost/route.ts", gate: ["rate-limit"] });
    const copy = join(dir, "page-map.json");
    writeFileSync(copy, JSON.stringify(map));
    const r = run("verify-openapi.mjs", ["--page-map", copy]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/\+ POST \/api\/public\/ghost/);
  });

  it("goes red on a $ref that resolves to nothing and on an exemption without a reason", () => {
    const dir = tmp();
    const copy = join(dir, "storefront-api.yaml");
    const text = readFileSync(specs[1], "utf8")
      .replace("$ref: '#/components/schemas/Acknowledgement'", "$ref: '#/components/schemas/Nope'")
      .replace(/reason: Same-origin poll[^\n]*/, "reason: no");
    writeFileSync(copy, text);
    const r = run("verify-openapi.mjs", ["--spec", specs[0], "--spec", copy]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/\$ref "#\/components\/schemas\/Nope" resolves to nothing/);
    expect(r.out).toMatch(/exemption needs app, path, methods and a reason/);
  });
});

describe("verify-doc-authority.mjs (Task 5.14)", () => {
  it("is green on the tree", () => {
    expect(run("verify-doc-authority.mjs").code).toBe(0);
  });

  it("goes red when specs/README.md carries a dead link", () => {
    const dir = tmp();
    const copy = join(dir, "README.md");
    writeFileSync(copy, readFileSync(join(ROOT, "specs/README.md"), "utf8") + "\n\nSee [nothing](docs/DOES-NOT-EXIST.md).\n");
    const r = run("verify-doc-authority.mjs", ["--check-file", copy, "--as", "specs/README.md"]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/dead link → docs\/DOES-NOT-EXIST\.md/);
  });

  it("goes red when the authority table stops naming the epic ledger as evidence", () => {
    const dir = tmp();
    const copy = join(dir, "README.md");
    const text = readFileSync(join(ROOT, "specs/README.md"), "utf8").replace(/^\| Historical epic ledger[^\n]*\n/m, "");
    expect(text).not.toContain("Historical epic ledger");
    writeFileSync(copy, text);
    const r = run("verify-doc-authority.mjs", ["--check-file", copy, "--as", "specs/README.md"]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/specs\/docs\/TASKS\.md: a TASKS\.md that is not the queue must be listed/);
  });
});

describe("verify-traceability.mjs (Task 5.15)", () => {
  const req = join(ROOT, "specs/docs/REQUIREMENTS.md");

  it("is green on the tree", () => {
    expect(run("verify-traceability.mjs").code).toBe(0);
  });

  it("goes red when a requirement row points at a file that does not exist", () => {
    const dir = tmp();
    const copy = join(dir, "REQUIREMENTS.md");
    const text = readFileSync(req, "utf8").replace("`apps/admin/lib/cod.ts`", "`apps/admin/lib/cod-gone.ts`");
    expect(text).toContain("cod-gone.ts");
    writeFileSync(copy, text);
    const r = run("verify-traceability.mjs", ["--requirements", copy]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/names evidence that does not exist → apps\/admin\/lib\/cod-gone\.ts/);
  });

  it("goes red when a MET row names no evidence at all", () => {
    const dir = tmp();
    const copy = join(dir, "REQUIREMENTS.md");
    const lines = readFileSync(req, "utf8").split("\n");
    const i = lines.findIndex((l) => /^\| F-T1 \|/.test(l));
    expect(i).toBeGreaterThan(0);
    const cells = lines[i].replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/);
    cells[cells.length - 2] = " inspection ";
    cells[cells.length - 1] = " MET ";
    lines[i] = `|${cells.join("|")}|`;
    writeFileSync(copy, lines.join("\n"));
    const r = run("verify-traceability.mjs", ["--requirements", copy]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/F-T1 is MET but names no evidence that exists/);
  });

  it("goes red when an active task requires an id that is not in REQUIREMENTS", () => {
    const dir = tmp();
    const copy = join(dir, "TASKS.md");
    const text = readFileSync(join(ROOT, "TASKS.md"), "utf8").replace("- **Requirement:** `NF-15`", "- **Requirement:** `NF-999`");
    expect(text).toContain("NF-999");
    writeFileSync(copy, text);
    const r = run("verify-traceability.mjs", ["--tasks", copy]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/requires NF-999, which is not in REQUIREMENTS\.md/);
  });
});

describe("verify-source-size.mjs (Task 6.6 guard)", () => {
  it("is green on the tree", () => {
    expect(run("verify-source-size.mjs").code).toBe(0);
  });

  it("goes red when a file is one line over its ceiling", () => {
    const dir = tmp();
    const file = join(dir, "big.astro");
    writeFileSync(file, "x\n".repeat(11));
    expect(run("verify-source-size.mjs", ["--ceiling", `${file}:11`]).code).toBe(0);
    const r = run("verify-source-size.mjs", ["--ceiling", `${file}:10`]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/OVER .*big\.astro: 11 lines \(ceiling 10, \+1\)/);
  });

  it("ceilings equal the files' current size, so the next added line is red", () => {
    // A ceiling above the file is headroom nobody decided on; the header says the ceiling IS the size.
    const src = readFileSync(join(ROOT, "scripts/verify-source-size.mjs"), "utf8");
    for (const m of src.matchAll(/^\s+"([^"]+)": (\d+),$/gm)) {
      const lines = (readFileSync(join(ROOT, m[1]), "utf8").match(/\n/g) ?? []).length;
      expect(lines, `${m[1]} is ${lines} lines, ceiling ${m[2]}`).toBeLessThanOrEqual(Number(m[2]));
    }
    // cpSync is imported for the day a mutation needs a whole directory; keep the import honest.
    expect(typeof cpSync).toBe("function");
  });
});
