import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scryptSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { tempPassword, hashPassword } from "./password";
import { codeOnly } from "../../../test/source-code";

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
/** `export { tempPassword } from "…"` — a SECOND import path for the one name. */
const REEXPORTS_MINT = new RegExp(String.raw`export\s*\{[^}]*\b${MINT}\b[^}]*\}\s*from\b`);
/** `{ tempPassword: () => … }` — the mint as an object member, which `\s*\(` cannot see past the colon. */
const MINT_AS_PROPERTY = new RegExp(
  String.raw`\b${MINT}\s*:\s*(?:async\s+)?(?:function\b|\(|[A-Za-z_$][\w$]*\s*=>)`,
);
const HASH = "hashPassword";
const DECLARES_HASH = new RegExp(String.raw`(?:export\s+)?(?:const|let|var|function)\s+${HASH}\b`);
/** Every call to the sink, with its argument. Assembled from `HASH` so this file cannot flag itself. */
const HASH_CALL = new RegExp(String.raw`\b${HASH}\s*\(([^)]*)\)`, "g");
/**
 * Is this argument a FIXED value?
 *
 * Two shapes, and they are the two that actually shipped: the literal written at the call site
 * (`createStore`), and an identifier bound to a literal in the same file (`invitePlatformAdmin`'s
 * `DEV_PASSWORD`). Post-`codeOnly` every literal comes back double-quoted, whichever way it was
 * spelled, so one leading `"` recognises all three of `'…'`, `"…"` and a template.
 *
 * A binding fed by anything else — a parameter, a call, a env read — is NOT judged here. It cannot be:
 * whether `hashPassword(next)` is a user's chosen password or a constant three files away is dataflow,
 * and this is a lexer. That is the honest scope, and it is enough: it is decidable, and it covers every
 * instance this repo has actually had.
 */
function fixedArgument(src: string, arg: string): string | null {
  if (arg.startsWith('"')) return "a literal";
  if (!/^[A-Za-z_$][\w$]*$/.test(arg)) return null; // an expression — not judged, see above
  const bound = new RegExp(String.raw`\b(?:const|let|var)\s+${arg}\s*(?::[^=;]*)?=\s*"`).test(src);
  return bound ? `\`${arg}\`, which is bound to a literal in this file` : null;
}
/**
 * ⚠️ THE ONE EXEMPTION, AND IT IS AN EXEMPTION FROM A TOTAL SCAN — not a list of files to look at.
 * That distinction is the whole lesson of this file: a guard bound to a LIST of targets has a blind
 * spot for everything off the list; a guard that scans everything and names its exceptions makes each
 * exception argue for itself, and a new file cannot hide in it.
 *
 * The seed genuinely hashes a fixed password (`tokophi123`) into the demo store's owner row, and that
 * is a KNOWN, TRACKED fact, not an oversight: AGENTS.md records that the credential is no longer
 * published anywhere but still authenticates on every existing deployment, and rotating it is a data
 * fix (N29) because the seed is not a migration. When N29 lands, delete this line — the guard is
 * already written.
 */
const FIXED_PASSWORD_ALLOWED = new Set(["packages/db/src/seed.ts"]);
/**
 * A credential-shaped binding fed by a random source — the mint written out under a different name.
 *
 * The NAME half is what keeps this specific, and the SOURCE half is deliberately allowed to be broad
 * because of it: `Math.random()` is in the list because `const pw = Math.random().toString(36)` is the
 * classic weak mint, and nothing named `jitter`, `seed` or `delay` can reach this pattern. Flagging
 * every `Math.random()` in the repo is the version that gets switched off — see the note on ② below.
 */
const HAND_ROLLED_MINT =
  /\b(?:pw|pass|passwd|password|cred|credential|temp)\w*\s*(?::\s*string\s*)?=\s*[^;]*?\b(?:randomBytes|Math\s*\.\s*random)\s*\(/i;

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
// Dot-directories are skipped wholesale: `.git`, `.astro`, `.next` — and `.claude/worktrees/*`, which
// on the main checkout holds entire second copies of this repo (another branch's mint is not ours).
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage"]);
const SOURCE = /\.(?:ts|tsx|mts|cts|cjs|astro|mjs|js|jsx)$/;

// ⚠️ EVERY EXTENSION THE REPO HOLDS IS EITHER SCANNED OR NAMED HERE AS INERT. The list above had
// `mts` and `cts` — neither of which any file in this repo uses — and not `cjs`, which is a module
// format Node executes. That is a blind spot of exactly the kind this file's own history is made of:
// a mint in an unlisted file type is invisible, silently, forever. So the extensions are CENSUSED
// instead of trusted: a file type nobody has classified turns the suite red with its own name in the
// message, and whoever added it decides which side it belongs on.
//
// Extension-LESS files are deliberately not scanned and the census ignores them. The four in this repo
// are Dockerfiles, and more to the point Node cannot import an extension-less file as a module from
// application code — so such a file cannot BE the second mint an app reaches. A standalone ops script
// that mints a credential is a real risk and a different guard; it is not this one.
const INERT_EXTENSIONS = new Set([
  ".webp", ".png", ".svg", ".woff2", ".csv", ".txt", // assets
  ".json", ".sql", ".md", ".css", ".sh", ".yaml", ".yml", // config, migrations, prose, shell
]);

/**
 * Every file GIT TRACKS, minus the skipped directories.
 *
 * ⚠️ This used to walk the filesystem, and that made the extension census go RED for anyone who had
 * run `tsc` before `vitest`: `*.tsbuildinfo` is gitignored, is a build artefact, and appeared in an
 * ordinary workflow. An alarm that fires on a normal working day is the alarm everybody learns to
 * scroll past — `verify-rls` sat red for weeks here and two cross-tenant leaks shipped past it.
 *
 * Tracked files are also the honest scope: the mint scanner asks "can a second mint be IN THIS REPO",
 * and something git does not carry is not in the repo. A build output, a scratch probe or another
 * agent's untracked worktree file is not a shipping credential path.
 */
function repoFiles(): string[] {
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\0")
    .filter(Boolean);
  return tracked
    .filter((rel) => !rel.split("/").some((seg) => seg.startsWith(".") || SKIP_DIRS.has(seg)))
    .map((rel) => path.join(REPO_ROOT, rel));
}

/**
 * Every source file in the repo, checked by `inspect`. No list to keep in sync — that was the bug.
 *
 * ⚠️ `inspect` receives the file's CODE (`test/source-code.ts`), never its text. A guard that greps
 * characters cannot tell a mint from a comment describing one, and this repo has now been bitten by
 * that in three separate guards. Here it runs in the false-RED direction — the notes above explaining
 * the 24-bit mint name the very patterns below — and a scanner that reports itself is a scanner
 * somebody deletes. Same reason the patterns are assembled from `MINT` rather than written out.
 */
let sources: Array<[string, string]> | null = null; // lexed once — two scans below, ~1 s each otherwise
function scanRepo(inspect: (rel: string, code: string) => string[]): string[] {
  sources ??= repoFiles()
    .filter((f) => SOURCE.test(f))
    .map((f) => [path.relative(REPO_ROOT, f), codeOnly(readFileSync(f, "utf8"))]);
  const out: string[] = [];
  for (const [rel, code] of sources) for (const problem of inspect(rel, code)) out.push(`${rel}: ${problem}`);
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
        // ①b The same thing as an object MEMBER. `{ tempPassword: () => randomBytes(3)… }` declares
        //    no binding and is not called with `(` next to the name, so ① and ③ both walk past it,
        //    and `obj.tempPassword()` reads at every call site exactly like the real one.
        if (MINT_AS_PROPERTY.test(src)) found.push(`defines ${MINT} as an object member — there must be exactly one`);
        // ①c A re-export. It declares nothing, so ① is blind to it, and it hands the ONE name a
        //    SECOND import path — including from a module outside this repo, which no file-walking
        //    scanner can ever look inside. `hashPassword` is deliberately NOT policed this way:
        //    `apps/admin/lib/auth.ts` re-exports it so `@/lib/auth` keeps resolving for its callers,
        //    and a re-export of the one implementation is not a copy. The mint is stricter because
        //    a second import path is how a second mint gets adopted without anyone editing a caller.
        if (REEXPORTS_MINT.test(src)) found.push(`re-exports ${MINT} — callers import it from "@tokophi/lib/password"`);
        // ② The shape, minted under another name: a credential-ish binding fed by a random source.
        //    Deliberately NOT "any randomBytes", and NOT "any Math.random()": a salt
        //    (`hashPassword`), a GCM iv (`lib/crypto.ts`), an OAuth nonce, a TOTP secret and a
        //    domain-verification token are all legitimate, and `Math.random()` appears in jitter,
        //    sampling and demo data. A guard that cries wolf on those gets switched off — this repo
        //    has already paid that bill once, with `verify-rls` sitting red for weeks while two
        //    cross-tenant leaks shipped past it. The BINDING NAME is the filter that keeps this
        //    specific enough to be believed; the random source can therefore be broad.
        //    ⚠️ Known and accepted limit: a mint bound to a name with no credential word in it
        //    (`genSecret`, `ownerLoginSecret`) is NOT caught here, and no name list can fix that —
        //    the next one would just be spelled differently. The durable guard for that shape is at
        //    the SINK, not the source: what `hashPassword()` is fed. `apps/super-admin/lib/
        //    no-fixed-password.test.ts` already asserts exactly that, and generalising it beyond the
        //    one file it names is the open work.
        if (HAND_ROLLED_MINT.test(src)) found.push("mints a password from a random source locally — import the shared mint instead");
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

  it("no call site anywhere feeds it a FIXED password — the sink, repo-wide", () => {
    // THE GUARD THIS FILE HAS BEEN ASKING FOR IN A COMMENT. The note on ② above says it plainly: a
    // mint bound to a name with no credential word in it (`genSecret`, `ownerLoginSecret`) is
    // invisible to a scanner that looks for the SOURCE, and no list of names can fix that. What every
    // instance DOES have in common is the sink — the value reaches `hashPassword()`.
    //
    // `apps/super-admin/lib/no-fixed-password.test.ts` has asserted this for `actions.ts` alone since
    // the `createStore` fix, and one file is exactly the scope that let a 24-bit mint survive its own
    // guard. It is scoped that way for a good reason — it can demand the argument be literally `pw`,
    // which is true there and nowhere else — so it KEEPS that stricter claim and this one covers the
    // other ~7 call sites, in four packages, that nothing was watching.
    //
    // Both shapes this catches have shipped here: the literal at the call site, and the module
    // constant. `apps/admin/lib/actions/security.ts` and `register.ts` hash a password the USER chose;
    // those are the sink working correctly and must stay green.
    const calls: string[] = [];
    const violations = scanRepo((rel, src) => {
      const found: string[] = [];
      for (const [, arg] of src.matchAll(HASH_CALL)) {
        calls.push(rel);
        const fixed = fixedArgument(src, arg.trim());
        if (fixed && !FIXED_PASSWORD_ALLOWED.has(rel)) found.push(`hashes ${fixed}`);
      }
      return found;
    });

    // A scan that reaches no call site passes forever — the same failure this file's extension census
    // exists for. There are 12 today across four packages; a floor of 8 survives ordinary refactoring
    // and still fails if the scan (or the module specifier) silently stops matching.
    expect(calls.length, "no hashPassword() call site was found — has the scan stopped reaching them?").toBeGreaterThanOrEqual(8);
    expect(violations, `a fixed password is hashed:\n  ${violations.join("\n  ")}`).toEqual([]);
  });

  it("scans every file type the repo actually holds", () => {
    // The scanner above is only as wide as `SOURCE`, and nothing anywhere said what `SOURCE` was
    // meant to cover. It listed `mts` and `cts` — no file in this repo uses either — and omitted
    // `cjs`, which Node executes. An unlisted extension is a mint the scanner cannot see, and it
    // fails SILENTLY, which is the property every defect in this file's history has shared.
    const unclassified = [
      ...new Set(
        repoFiles()
          .map((f) => path.extname(f))
          .filter((e) => e !== "" && !SOURCE.test(`x${e}`) && !INERT_EXTENSIONS.has(e)),
      ),
    ].sort();

    expect(
      unclassified,
      `unclassified file type(s): ${unclassified.join(", ")}. Add each to SOURCE (the mint scanner ` +
        `must read it) or to INERT_EXTENSIONS (it cannot hold JavaScript).`,
    ).toEqual([]);
  });
});
