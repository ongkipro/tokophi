import { describe, expect, it } from "vitest";
import { SOURCE_SCAN_TIMEOUT_MS, codeOfFile, codeOnly, isTestFile, textOfFile, trackedSources } from "../../../test/source-code";
import { PROMO_AI_DISABLED_ID, promoAiEnabled } from "./promo-ai";

// ── TASK 8.7 — NO REQUEST PATH SHELLS OUT TO AN EXTERNAL CLI ────────────────────────────────────
//
// `promo-ai.ts` used to `execFile("claude", …)`. The binary is on a developer's laptop and not in
// the production image, so Seller → Promo → "Generate dengan AI" answered *"Claude CLI tidak
// ditemukan di server."* on every press in production, for as long as the button had existed —
// implemented-looking, dead. `tsc`, `eslint` and the build were all green throughout, and they
// always will be: a missing binary is a runtime fact about the CONTAINER, and no compiler has an
// opinion about it. This test is the thing that has an opinion.
//
// ⚠️ IT SCANS EVERY APP SOURCE AND NAMES ITS EXCEPTIONS — never a list of files. That is the
// `inventory-location` lesson: a guard bound to the targets it happens to know about goes green
// while the next copy lands somewhere it was never pointed at.
//
// ⚠️ `codeOnly`, never the raw text. This very file contains the string "child_process" in prose,
// and so does the replacement module's own comment explaining why it is gone; a text match would be
// red on the fix and green on nothing.
const SCAN_DIRS = ["apps/admin", "apps/super-admin", "apps/storefront/src"];

// The one process-spawning API family, in every shape node exposes it. Whitespace-tolerant because
// `codeOnly` joins tokens with single spaces (`node:child_process` arrives as `node : child_process`).
// ⚠️ NOT a bare `exec(` / `fork(` — `RegExp.prototype.exec` is everywhere in this repo and a guard
// that cries wolf is a guard people learn to scroll past (the `verify-rls` lesson). You cannot spawn
// anything without naming the module, so `child_process` is the load-bearing half; the two call
// shapes are the belt.
const SPAWNS = /child_process|\bexecFile(?:Sync)?\s*\(|\bspawn(?:Sync)?\s*\(/;

function appSources(): string[] {
  return trackedSources().filter(
    (rel) => SCAN_DIRS.some((d) => rel.startsWith(`${d}/`)) && /\.tsx?$/.test(rel) && !isTestFile(rel),
  );
}

describe("no request path spawns an external CLI (Task 8.7)", () => {
  it("finds no child_process anywhere in the three app surfaces", () => {
    const files = appSources();
    // A floor: if the lister ever returns nothing this passes having read nothing, which is the
    // failure mode of every sweep in this repo that has gone quietly vacuous.
    expect(files.length, "no app sources scanned — has trackedSources stopped reaching them?").toBeGreaterThan(100);

    const offenders = files.filter((rel) => SPAWNS.test(codeOfFile(rel)));
    expect(offenders, `these run an external process on a request path: ${offenders.join(", ")}`).toEqual([]);
  }, SOURCE_SCAN_TIMEOUT_MS);

  it("MUTATION SELF-CHECK: the same predicate fires on the code that was removed", () => {
    // Proved red before it was trusted. Without this the regex could match nothing at all — a
    // typo'd pattern and a clean repo are indistinguishable from a green run.
    const removed = `
      import { execFile } from "node:child_process";
      function runClaude(prompt: string) {
        return new Promise((resolve) => {
          execFile("claude", ["-p", prompt, "--output-format", "json"], {}, (err, stdout) => resolve(stdout));
        });
      }`;
    expect(SPAWNS.test(codeOnly(removed))).toBe(true);

    // …and it does NOT fire on the comment that explains the removal — which `promo-ai.ts` itself
    // now carries, so a raw-text guard would be permanently red on the fix and green on nothing.
    // ⚠️ `codeOnly` strips comments but does NOT blank a string literal's letters (it only
    // neutralises separators), so this claim is about comments and nothing wider. A future
    // `const cmd = "child_process"` would trip the sweep, and that is the safe direction.
    const comment = `// it used to import child_process and call execFile("claude", …) — it does not any more
      const model = "claude-opus-5";`;
    expect(SPAWNS.test(codeOnly(comment))).toBe(false);
  });
});

describe("the promo-AI feature is honestly off when the key is absent", () => {
  const withKey = (v: string | undefined, fn: () => void) => {
    const prev = process.env.ANTHROPIC_API_KEY;
    try {
      if (v === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = v;
      fn();
    } finally {
      if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prev;
    }
  };

  it("is off with the key unset, and off with the whitespace-only value Coolify writes", () => {
    // `VAR: ''` is what Coolify writes when a value has not arrived — the 5 August failure. "Defined"
    // is not the question; "filled in" is.
    withKey(undefined, () => expect(promoAiEnabled()).toBe(false));
    withKey("   ", () => expect(promoAiEnabled()).toBe(false));
    withKey("sk-ant-whatever", () => expect(promoAiEnabled()).toBe(true));
  });

  it("says why, in Indonesian, without naming an internal variable at the merchant", () => {
    // The value is asserted, not the source: this is the string a merchant reads.
    expect(PROMO_AI_DISABLED_ID).toMatch(/belum aktif/i);
    expect(PROMO_AI_DISABLED_ID).not.toMatch(/ANTHROPIC|env|process/i);
  });

  it("the server action refuses on its own — the hidden button is never the boundary", () => {
    // A server action takes its argument from the client, so `disabled` on a <Button> gates nothing.
    const action = codeOfFile("apps/admin/lib/actions/promo.ts");
    expect(action).toMatch(/if\s*\(\s*!\s*promoAiEnabled\s*\(\s*\)\s*\)\s*return\s*\{\s*ok\s*:\s*false/);
  });

  it("the editor disables the control and renders the reason instead of a button that errors", () => {
    const ui = codeOfFile("apps/admin/app/(admin)/promo/[id]/promo-editor-client.tsx");
    expect(ui).toMatch(/disabled\s*=\s*\{\s*!\s*aiEnabled/);
    // ⚠️ The SENTENCE lives inside a string literal, and `codeOnly` inerts every literal's contents
    // on purpose — so the claim "this text is rendered" must be made over the text, per the rule in
    // AGENTS.md. Comments are still stripped, so the note above explaining the fix stays legal.
    expect(textOfFile("apps/admin/app/(admin)/promo/[id]/promo-editor-client.tsx")).toMatch(/belum aktif/);
  });

  it("the key is read at call time and never leaves the server", () => {
    const src = codeOfFile("apps/admin/lib/promo-ai.ts");
    // Module-scope reads get baked in at build time, when the env is empty — the same trap
    // `@tokophi/lib/google-oauth` carries a comment about.
    expect(src).toMatch(/server-only/);
    // The value goes into one header and nowhere else: not a URL, not a log line, not a return.
    expect(src).not.toMatch(/console\s*\.\s*(log|error|warn)\s*\(\s*[^)]*(ANTHROPIC_API_KEY|\bkey\b)/);
    // It goes into ONE request header and nowhere else — never spliced into a URL or a body.
    expect(src).toMatch(/"x-api-key"\s*:\s*key/);
    expect(src).not.toMatch(/\$\{\s*key\s*\}/);
  });
});
