import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scryptSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { tempPassword, hashPassword } from "./password";

// This is the credential handed to a STORE OWNER and to an INVITED OPERATOR. The account it opens
// reads every buyer's name, WhatsApp number and delivery address, and reaches the payout actions.
//
// It used to be `"tokophi-" + randomBytes(3).toString("hex")` — **24 bits, 16,7 million candidates**
// — while `apps/admin` kept its own copy at `randomBytes(4)` (32 bits). Two implementations, and the
// weaker of the two was the one on the store-owner path. 24 bits is a real attack the moment the
// login door is unthrottled, and no login rate-limit was found (investigated under N18; deliberately
// NOT built here — it is an owner decision, see specs/docs/tasks/NEXT.md).
//
// ⚠️ THE FLOOR BELOW IS THE POINT OF THIS FILE. It is measured from what the generator actually
// EMITS — not read off a constant in `password.ts` — so shortening the string, narrowing the
// alphabet, or biasing the mapping all move the number. A future edit that makes this credential
// cheaper to guess must go red here.

const SAMPLES = 5_000;
const FLOOR_BITS = 48;

// Passwords that are public knowledge: the seed's, and anything ever shipped as a default.
const PUBLISHED = ["tokophi123", "tokophi", "password", "admin123"];

/** The longest prefix every sample shares — a fixed prefix carries no entropy and must not be counted. */
function commonPrefix(samples: string[]): string {
  let n = 0;
  while (samples.every((s) => s[n] !== undefined && s[n] === samples[0][n])) n++;
  return samples[0].slice(0, n);
}

// ── THE SECOND-MINT SCANNER ──────────────────────────────────────────────────────────────────────
// The patterns are assembled from `MINT` instead of being written out, so that THIS FILE does not
// match its own signature — a scanner that reports itself is a scanner someone deletes.
const MINT = "tempPassword";
const MINT_MODULE = "packages/lib/src/password.ts";
const DECLARES_MINT = new RegExp(String.raw`(?:export\s+)?(?:const|let|var|function)\s+${MINT}\b`);
const CALLS_MINT = new RegExp(String.raw`\b${MINT}\s*\(`);
const IMPORTS_MINT = new RegExp(String.raw`import\s*\{[^}]*\b${MINT}\b[^}]*\}\s*from\s*"@tokophi/lib/password"`);
const IMPORTS_MINT_LOCALLY = new RegExp(String.raw`import\s*\{[^}]*\b${MINT}\b[^}]*\}\s*from\s*"\./password"`);
const HASH = "hashPassword";
const DECLARES_HASH = new RegExp(String.raw`(?:export\s+)?(?:const|let|var|function)\s+${HASH}\b`);
/** A credential-shaped binding fed by `randomBytes` — the mint written out under a different name. */
const HAND_ROLLED_MINT = /\b(?:pw|pass|passwd|password|cred|credential|temp)\w*\s*(?::\s*string\s*)?=\s*[^;\n]*\brandomBytes\s*\(/i;

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
// Dot-directories are skipped wholesale: `.git`, `.astro`, `.next` — and `.claude/worktrees/*`, which
// on the main checkout holds entire second copies of this repo (another branch's mint is not ours).
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage"]);
const SOURCE = /\.(?:ts|tsx|mts|cts|astro|mjs|js|jsx)$/;

/** Every source file in the repo, checked by `inspect`. No list to keep in sync — that was the bug. */
function scanRepo(inspect: (rel: string, src: string) => string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && SOURCE.test(entry.name)) {
        const rel = path.relative(REPO_ROOT, full);
        for (const problem of inspect(rel, readFileSync(full, "utf8"))) out.push(`${rel}: ${problem}`);
      }
    }
  };
  walk(REPO_ROOT);
  return out.sort();
}

describe("the temp password is expensive to guess", () => {
  const samples = Array.from({ length: SAMPLES }, () => tempPassword());

  it(`carries at least ${FLOOR_BITS} bits of min-entropy`, () => {
    const prefix = commonPrefix(samples);
    const bodies = samples.map((s) => s.slice(prefix.length));

    // A variable-length mint would make the arithmetic below a lie, and it is also a usability bug
    // (nobody can tell a truncated password from a short one). Refuse it outright.
    const lengths = new Set(bodies.map((b) => b.length));
    expect([...lengths], "the random part must be a fixed length").toHaveLength(1);
    const length = bodies[0].length;

    // MIN-entropy (−log2 of the most likely symbol), not Shannon: the attacker guesses the likeliest
    // candidates first, so the worst symbol is the one that decides the cost. Estimating it from
    // observed frequencies is what makes a biased mapping — `% 26` over a 26-letter alphabet, say —
    // score below its nominal alphabet size instead of being flattered by it.
    const counts = new Map<string, number>();
    for (const body of bodies) for (const ch of body) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    const draws = SAMPLES * length;
    const pMax = Math.max(...counts.values()) / draws;
    const bits = length * -Math.log2(pMax);

    expect(
      bits,
      `only ${bits.toFixed(1)} bits: ${length} symbols over an observed alphabet of ${counts.size}`,
    ).toBeGreaterThanOrEqual(FLOOR_BITS);
  });

  it("is random per call, and never a published default", () => {
    // A constant (or a value derived from the input) collapses this to 1.
    const seen = new Set(samples);
    expect(seen.size).toBe(SAMPLES);
    for (const pw of seen) expect(PUBLISHED).not.toContain(pw);
  });

  it("a stored hash never verifies against a published password", () => {
    // What the attack actually is: knowing the merchant's email, try the default. scrypt is
    // deterministic per salt, so this is exactly the check `verifyPassword` runs at login.
    const stored = hashPassword(tempPassword());
    const [salt, hash] = stored.split(":");
    expect(salt).toHaveLength(32);
    for (const guess of PUBLISHED) {
      expect(scryptSync(guess, salt, 64).toString("hex"), `"${guess}" must not open the account`).not.toBe(hash);
    }
  });

  it("is the ONLY mint in the repo — no file keeps a private copy", () => {
    // THE regression this file exists to stop is not a weak number, it is a SECOND number: a local
    // mint is how the fix stops travelling, and how the WEAKER number survives the commit that
    // replaced it.
    //
    // ⚠️ THIS CHECK USED TO ITERATE A HARDCODED TWO-FILE LIST (`apps/admin/lib/actions/users.ts`,
    // `apps/super-admin/lib/actions.ts`) — so a private mint in any THIRD file was invisible to it.
    // That is not hypothetical: `apps/super-admin/lib/temp-password.ts` survived, exported, still on
    // `randomBytes(3)` = 24 bits, through the commit that claimed to delete it and through a deploy,
    // while this test — written to stop exactly that — stayed green, because the file was not on the
    // list. A guard with a list is a guard with a blind spot. **Do not reintroduce a list here.**
    const violations = scanRepo((rel, src) => {
      const found: string[] = [];
      if (rel !== MINT_MODULE) {
        // ① The name. A second declaration of it, anywhere, whatever it is worth in bits.
        if (DECLARES_MINT.test(src)) found.push(`declares its own ${MINT}() — there must be exactly one`);
        // ② The shape, minted under another name: a credential-ish binding fed by `randomBytes`.
        //    Deliberately NOT "any randomBytes": a salt (`hashPassword`), a GCM iv (`lib/crypto.ts`),
        //    an OAuth nonce, a TOTP secret and a domain-verification token are all legitimate and
        //    none of them is a login credential. A guard that cries wolf on those gets switched off.
        if (HAND_ROLLED_MINT.test(src)) found.push("mints a password from randomBytes() locally — import the shared mint instead");
      }
      // ③ Every CALLER reaches the one module. `@tokophi/lib/password` from an app; the relative
      //    path is only legal inside packages/lib, where the specifier does not exist yet.
      if (CALLS_MINT.test(src) && rel !== MINT_MODULE) {
        const ok = IMPORTS_MINT.test(src) || (rel.startsWith("packages/lib/") && IMPORTS_MINT_LOCALLY.test(src));
        if (!ok) found.push(`calls ${MINT}() without importing it from "@tokophi/lib/password"`);
      }
      return found;
    });

    expect(violations, `a SECOND mint exists:\n  ${violations.join("\n  ")}`).toEqual([]);
  });

  it("storing a password has ONE implementation too", () => {
    // There were FIVE copies of `hashPassword` — here, `apps/admin/lib/auth.ts`,
    // `apps/admin/lib/actions/security.ts`, `packages/db/src/seed.ts` and the deleted
    // `super-admin/lib/temp-password.ts` — all byte-identical, so nothing had drifted YET. That is
    // exactly what was true of the mint too, until one copy said `randomBytes(3)` and the other
    // `randomBytes(4)` and the weak one was the one on the store-owner path.
    //
    // What can silently drift here is not a name but a NUMBER: the salt width, the 64-byte key
    // length, or scrypt's cost parameters. Two of those change what `verifyPassword` can read back
    // (every affected login stops working); one of them just makes the stored hash cheaper to attack
    // and nothing anywhere fails. `apps/admin/lib/auth.ts` re-exports this function rather than
    // declaring one, so `@/lib/auth` still resolves for its callers — a re-export is not a copy.
    const violations = scanRepo((rel, src) =>
      rel !== MINT_MODULE && DECLARES_HASH.test(src)
        ? [`declares its own ${HASH}() — import it from "@tokophi/lib/password"`]
        : [],
    );

    expect(violations, `a SECOND password hasher exists:\n  ${violations.join("\n  ")}`).toEqual([]);
  });
});
