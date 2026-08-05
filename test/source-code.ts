// ONE answer to "what does this file actually EXECUTE?", for every guard in the repo that reads
// source text.
//
// ── THE RULE ──────────────────────────────────────────────────────────────────────────────────────
//
//   **A guard may assert against a file's CODE. It may never assert against a file's TEXT.**
//
// Sometimes a guard must read the source: when the bug IS the markup and the fix is the ABSENCE of
// markup, there is nothing to import and call — no type-checker has an opinion about a picker that is
// no longer rendered. `cart-variant.test.ts` and `h1-floor.test.ts` are both that shape, honestly.
// What is never honest is matching the CHARACTERS, because the same characters mean three different
// things:
//
//   1. `// case "lookbook": return <Lookbook />`   a comment. Not code. Renders nothing.
//   2. ``const doc = `case "lookbook": …` ``       a string. Not code. Renders nothing.
//   3. `case "lookbook": return <Lookbook />`      code.
//
// A regex over the raw file cannot tell them apart, so every such guard is one commented-out line
// away from being green over a broken shop. This repo has now paid for that THREE times, in three
// different guards, one of them introduced by the very commit that fixed it in another file:
//
//   · `section-renderer-exhaustive.test.ts` — an arm commented out, four tests green, a merchant's
//     `lookbook` section silently dropped from a live storefront.
//   · `cart-variant.test.ts` — `normalizeCart(...)` commented out of `readCart()`, seven tests green,
//     and the repair that rescues carts already sitting in shoppers' browsers gone.
//   · `h1-floor.test.ts` — a hand-rolled `stripComments` that knew about `{/* */}` and `<!-- -->` and
//     not about `//`, over assertions that then read raw text anyway.
//
// Each was fixed on its own, by hand, differently. That is the actual defect: there was no shared
// answer, so every guard invented one and every invention had a different hole.
//
// ── TWO QUESTIONS, TWO FUNCTIONS — AND CHOOSING WRONG IS THE INTERESTING PART ─────────────────────
//
//   `codeOnly(src)`            what this file EXECUTES. Comments gone, every literal's contents INERT.
//   `textWithoutComments(src)` what this file can EMIT. Comments gone, literals kept VERBATIM.
//
// Almost every guard wants `codeOnly`. The exception is a guard whose claim is about MARKUP, because
// markup built by concatenating a JS string and assigning `innerHTML` really is emitted — that is how
// the search palette's `<img>` exists in no `.astro` template and on no built page, and it is written
// down in CLAUDE.md as its own trap. `h1-floor.test.ts` sweeps the section components for anything
// that emits an `<h1>`; a `<h1>` inside a template literal would be one, so inerting the literal there
// would turn a real second heading into a green run. Both functions drop comments, which is the half
// every guard needs and the half every hand-rolled stripper got wrong.
//
// ── WHAT THEY DO ──────────────────────────────────────────────────────────────────────────────────
//
// Both run the TypeScript **scanner** over the source and re-emit the tokens, with two rules:
//
//   · **Comments are gone.** A comment is trivia to a lexer — it is not a token, so there is nothing
//     to strip and nothing to get wrong. This is why the lexer beats a regex `replace`: a regex that
//     removes `/* … */` also removes half of `"https://x"`, which is the same class of mistake one
//     layer down.
//   · **Every LITERAL's contents are made inert** (`codeOnly` only). A string, a template (including the pieces around
//     `${…}`) and a regex are re-emitted as a quoted run in which every character outside
//     `[A-Za-z0-9_.@/-]` becomes `·`. So the *word* survives — `"lookbook"` is still `"lookbook"`,
//     `"@tokophi/lib/password"` is still itself, and a guard can still assert on a module specifier or
//     an enum member — while the *punctuation and whitespace that would let a literal imitate the
//     syntax around it* cannot. ``const doc = `case "lookbook": return <Lookbook />` `` becomes
//     `const doc = "case··lookbook···return··Lookbook··/·"`: no quote, no colon, no `<`, no space,
//     and therefore no `case "…": return <…>` for any assertion to find.
//
// Tokens are joined with a single space, so an assertion written against this output must tolerate
// whitespace between tokens (`/case\s+"x"\s*:/`, not `/case "x":/`). That is deliberate: it makes the
// assertions robust to reformatting too, and there is exactly one convention to learn.
//
// ── WHY NOT THE AST ───────────────────────────────────────────────────────────────────────────────
//
// Because the files that need this are `.astro`, and an `.astro` file is not a TypeScript program:
// frontmatter fences, then Astro template markup. `ts.createSourceFile` produces an error tree over
// it, and building the guards on a tree whose shape depends on TypeScript's error recovery is worse
// than building them on tokens. The scanner, by contrast, is a lexer — it has no opinion about
// whether the whole file parses, and comments and literals are exactly the two things a lexer already
// knows how to identify. `typescript` is already a dependency here, so this adds none.
//
// The honest limit: this is still text matching, one level up. It knows a literal from code; it does
// not know a `case` in a `switch` from the word `case` somewhere else. Where a guard can import the
// thing and call it, it should — reading source is the fallback for claims about absence.
import ts from "typescript";

/** Characters a literal may keep. Everything else is what lets a literal imitate its surroundings. */
const INERT = /[^A-Za-z0-9_.@/-]/g;

/** Kinds whose text is a literal's CONTENTS rather than syntax. */
const LITERAL = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.RegularExpressionLiteral,
]);

/**
 * A `/` starts a regex literal only where an expression may start. The set below is "tokens after
 * which a `/` is division" — everything else (operators, `return`, `(`, `,`, start of file …) can be
 * followed by one.
 *
 * `}` and `>` are listed as division DELIBERATELY, and the reason is JSX rather than JavaScript:
 * `<Hero {...props} />` and `</div>` both put a `/` exactly there, and re-scanning those as a regex
 * would swallow real code up to the next `/` on the line. A regex literal immediately after `}` or
 * `>` is vanishingly rare; a self-closing JSX tag is on every line of a renderer. Same for `<`:
 * `</div>` is a closing tag, never a comparison against a regex.
 */
const DIVISION_FOLLOWS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.Identifier,
  ts.SyntaxKind.PrivateIdentifier,
  ts.SyntaxKind.NumericLiteral,
  ts.SyntaxKind.BigIntLiteral,
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.RegularExpressionLiteral,
  ts.SyntaxKind.CloseParenToken,
  ts.SyntaxKind.CloseBracketToken,
  ts.SyntaxKind.CloseBraceToken,
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.PlusPlusToken,
  ts.SyntaxKind.MinusMinusToken,
  ts.SyntaxKind.ThisKeyword,
  ts.SyntaxKind.SuperKeyword,
  ts.SyntaxKind.TrueKeyword,
  ts.SyntaxKind.FalseKeyword,
  ts.SyntaxKind.NullKeyword,
]);

/**
 * **The default.** The source's executable tokens, joined by single spaces, with every literal's
 * contents made inert — so a comment, a string or a template can never satisfy an assertion about
 * code.
 *
 * Assert against this, never against `readFileSync(...)` directly. Write the assertions
 * whitespace-tolerantly (`\s*` between tokens) — see the note above.
 */
export const codeOnly = (source: string): string => scan(source, true);

/**
 * The source's tokens with COMMENTS removed and literals left verbatim, joined by single spaces.
 *
 * Only for a guard whose claim is about text the file can EMIT rather than about what it executes —
 * markup concatenated into a string is emitted markup. If you are asserting about code, you want
 * {@link codeOnly}; this one will happily read a `case "lookbook"` out of a template literal.
 */
export const textWithoutComments = (source: string): string => scan(source, false);

function scan(source: string, inertLiterals: boolean): string {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    /* skipTrivia */ true,
    ts.LanguageVariant.JSX,
    source,
  );
  const out: string[] = [];

  // `${…}` inside a template: the scanner does NOT resume the template by itself. It hands back a
  // `}` and, unless we ask it to re-scan, carries on lexing the rest of the template AS CODE — which
  // is the smuggle this file exists to close, merely one `${}` further along. Each stack entry is the
  // brace depth at which its template continues.
  const templates: number[] = [];
  let braces = 0;
  let prev: ts.SyntaxKind | undefined;

  for (;;) {
    let kind = scanner.scan();
    if (kind === ts.SyntaxKind.EndOfFileToken) break;

    if (
      (kind === ts.SyntaxKind.SlashToken || kind === ts.SyntaxKind.SlashEqualsToken) &&
      !DIVISION_FOLLOWS.has(prev as ts.SyntaxKind)
    ) {
      kind = scanner.reScanSlashToken();
    }

    if (kind === ts.SyntaxKind.CloseBraceToken && templates.length && braces === templates[templates.length - 1]) {
      templates.pop();
      kind = scanner.reScanTemplateToken(/* isTaggedTemplate */ false);
      if (kind === ts.SyntaxKind.TemplateMiddle) templates.push(braces);
    } else if (kind === ts.SyntaxKind.OpenBraceToken) {
      braces++;
    } else if (kind === ts.SyntaxKind.CloseBraceToken) {
      braces = Math.max(0, braces - 1);
    }

    if (kind === ts.SyntaxKind.TemplateHead) templates.push(braces);

    out.push(
      inertLiterals && LITERAL.has(kind)
        ? `"${(kind === ts.SyntaxKind.RegularExpressionLiteral ? scanner.getTokenText() : scanner.getTokenValue()).replace(INERT, "·")}"`
        : scanner.getTokenText(),
    );
    prev = kind;
  }

  return out.join(" ");
}

/**
 * The timeout a REPO-WIDE source scan needs, and why it is not the 5 s default.
 *
 * A guard that lexes the whole repo is doing real, bounded work. Profiled on this machine while
 * integrating audit wave 7:
 *
 * | step                                        | cost        |
 * |---------------------------------------------|-------------|
 * | `readdirSync` walk of `apps/`               | **8 ms**    |
 * | `readFileSync` all 455 files (3,3 MB)       | **24 ms**   |
 * | lex 3,3 MB through the TypeScript scanner   | **819 ms**  |
 *
 * The filesystem is NOT the cost — swapping the walk for `git ls-files` (also 8 ms) buys nothing.
 * The scanner is. Measured per test, the two that pay it in full are
 * `password.test.ts > is the ONLY mint in the repo` (**3.544 ms**, it scans every tracked file, a
 * wider set than `apps/`) and `no-published-credentials.test.ts > …'the seeded password'` (**2.699 ms**,
 * the first of three patterns fills the memo for the rest). Every other scanning guard is under
 * 130 ms and must NOT be given this — a long timeout on a fast test only hides a future regression.
 *
 * Solo, both pass comfortably. Under `npm test` they share cores with 41 other test files and both
 * blew past 5 s, so the suite went red on a codebase where nothing was wrong. **A test that fails
 * sometimes teaches people to ignore red**, and this repo has already paid that bill in full:
 * `verify-rls` sat red for weeks, everyone learned to scroll past it, and two cross-tenant leaks
 * shipped past a verifier that was already failing.
 *
 * ⚠️ **AND THE "REAL FIX" DOES NOT EXIST — I FILED IT WITH A NUMBER I HAD MIS-MEASURED.**
 * The ceiling above was raised alongside `NEXT.md` N49, which claimed a prefilter would be a ~400×
 * win because "1 of 455 files contains any needle in its raw text". **That measurement used LITERAL
 * needles. The patterns are whitespace-tolerant REGEXES**, and that changes the answer completely.
 *
 * A match in the LEXED text needs each of the pattern's whitespace-free CHUNKS present in the RAW
 * source as a verbatim token — so the only SOUND cheap prefilter is "raw contains chunk X".
 * Selectivity, measured over the same 458 files:
 *
 * | pattern | its chunks | best sound prefilter | files it selects |
 * |---|---|---|---|
 * | `/tokophi123/` | one | `tokophi123` | **1 (0,2%)** |
 * | `/ongki\s*@\s*batiknusantara\s*\.\s*id/` | `ongki` `@` `batiknusantara` `.` `id` | `batiknusantara` | **1 (0,2%)** |
 * | `/admin\s*@\s*tokophi\s*\.\s*id/` | `admin` `@` `tokophi` `.` `id` | — | **123 (26,9%)** |
 *
 * The third pattern is the one that decides it: its longest chunk is `tokophi`, which appears in
 * **68,6%** of this repo's files (every `@tokophi/*` import), and requiring ALL its chunks still
 * leaves 123. Since the three patterns share ONE memoised lex pass, prefiltering the two selective
 * ones saves nothing while the third still lexes everything. Dropping the memo and prefiltering per
 * pattern gives **458 → 125 lexes: 3,7×**, not 400×.
 *
 * **So N49 is CLOSED, not deferred.** 3,7× is not worth hand-rolled per-pattern chunk extraction
 * inside a security guard, where being subtly wrong means silently green forever — the exact failure
 * this module exists to end, found nine times in nine guards. The ceiling is the fix.
 *
 * ⚠️ One more thing that was checked rather than assumed: the feared "comment splice" (a comment
 * between two halves of a credential, removed by lexing, creating a match the raw text never had)
 * **cannot happen inside a string literal.** A block comment written between `admin@` and
 * `tokophi.id` INSIDE the quotes lexes as ONE string token, comment characters and all, and matches
 * neither side. It would need the two halves as separate CODE tokens, which no shipped credential
 * shape here has ever been.
 *
 * ⚠️⚠️ AND THE EXAMPLE THAT SENTENCE ORIGINALLY SPELLED OUT **BROKE THIS FILE.** Writing the
 * splice literally put a `*` immediately followed by `/` inside this block comment, which CLOSED it
 * early: 18 of 50 test files then failed to import, while the 296 tests that still collected all
 * passed — a green-looking count over a broken module. Caught only by running the suite. Do not
 * write that two-character sequence anywhere in this comment; describe it in words instead.
 */
export const SOURCE_SCAN_TIMEOUT_MS = 20_000;
