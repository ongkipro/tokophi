# Tests — the money suites and the source-reading guards

> Moved **verbatim** from `AGENTS.md` on 2026-10-28 (Claude Code warns when `AGENTS.md` exceeds 150k chars, and it is
> loaded in full into every session). `AGENTS.md` keeps a short digest of the rules plus a pointer here; this file keeps
> the reasoning and the incident history. Words like "above"/"below"/"the next section" refer to the old single-file
> layout — follow the named file or section instead. **If this file and the code disagree, the code wins — fix this file.**

#### ⚠️ The money suites run by default now — keep it that way

`test/db-setup.ts` (vitest `globalSetup`) derives `<DATABASE_URL>_test`, **creates that database if it
is absent, migrates it to head** and exports `TEST_DATABASE_URL`. So `npm test` exercises the ledger
against real Postgres on any machine where `docker compose up -d db` is running.

This exists because the opposite was true and nobody noticed: the suites skipped unless a developer
exported `TEST_DATABASE_URL` by hand, so **22 tests over the ledger — the code that decides when a
sale becomes withdrawable — never ran**, in anyone's default run, with no CI to catch it. Same family
as the `verify-rls` incident below: a gate that does not run is not a gate.

- **The guard is load-bearing: the resolved name MUST end in `_test`, or setup throws.** These suites
  seed stores, orders and payments. They roll every transaction back, but pointing them at the shared
  dev database must remain impossible. Do not relax it.
- **An unreachable database still SKIPS**, so a laptop without Docker gets a green run — but it prints
  a banner naming the reason, instead of the old silent pass. `npm run test:db` turns that skip into a
  failure; use it before a PR.
- An explicit `TEST_DATABASE_URL` still wins over the derived one.

#### ⚠️ A guard reads a file's CODE, never its TEXT — `test/source-code.ts`

Ten test files in this repo read source with `readFileSync`, and **all ten now go through
`test/source-code.ts`** (2026-08-03) — there is no hand-rolled comment stripper left. They read
source for an honest reason: when the bug IS the markup and the fix is the **absence** of markup, there is nothing to import and
call, and no type-checker has an opinion. What is never honest is matching the **characters**, because
a comment is text, and code inside a string is text:

```js
// case "lookbook": return <Lookbook />        ← a comment. Renders nothing.
const doc = `case "lookbook": return <Lookbook />`;  ← a string. Renders nothing.
case "lookbook": return <Lookbook />;         ← code.
```

**This defect has now been found NINE times, in nine different guards** (four in the wave that built
this module, five in the sweep after it) **— one of them introduced by the very commit that fixed it
elsewhere.** Each was patched by hand, differently, and every hand-rolled
"ignore the comments" had a different hole — a line-prefix filter that missed the checkout file
entirely, a `{/* */}`+`<!-- -->` stripper that did not know about `//`, a lexer walk that joined
`getTokenText()` and so re-injected every string's raw source, and a two-regex stripper whose `[^:]`
saved `https://` and nothing else while a `/*` inside an ordinary glob string ate the file down to the
next `*/`. So the rule is a shared module now — and **each one was proved blind against a mutated copy
of its own target BEFORE being converted, then proved red against the same mutation after**, because a
guard converted on faith can be green for the wrong reason (that mistake has been made and caught
here). Mutate a COPY and point the test at it; never edit product source another stream may own:

| use | for | it does |
|---|---|---|
| `codeOnly(src)` | **the default** — any claim about what a file executes | comments gone, every literal's contents inert |
| `textWithoutComments(src)` | only a claim about MARKUP the file can emit | comments gone, literals kept verbatim |

Both run the TypeScript **scanner** (a comment is trivia, so there is nothing to strip and nothing to
get wrong) and join tokens with single spaces — **so write assertions whitespace-tolerantly**
(`d\s*\.\s*variant`), or compare against `codeOnly("<the snippet>")`, which normalises both sides.
Not the AST: the files that need this are `.astro`, which is not a TypeScript program. `typescript`
is already a dependency, so this costs no install.

⚠️ **CHOOSE PER ASSERTION, NOT PER FILE**, and `textWithoutComments` is no longer `h1-floor`'s alone.
It is for any claim about text the file EMITS to something that then executes or renders it, and there
are three shapes here, not one: markup concatenated into a JS string and assigned to `innerHTML` (the
search palette's `<img>` exists that way and nothing else); a CREDENTIAL, which lives inside the string
literal being hunted, so `codeOnly` would inert the evidence and go permanently green
(`no-published-credentials.test.ts`); and **raw SQL inside a `sql` template**, which Postgres executes
exactly the way a browser renders markup — `codeOnly` turns `is_default desc` into `is_default·desc`,
so a pattern for a real copy could never match again (`inventory-location.test.ts` uses BOTH helpers,
one per assertion, and says why at each). Reach for `codeOnly` unless you can say why the string
contents count — then say it, in the file.
⚠️ **`<!-- … -->` is NOT a JavaScript comment and neither function removes it** — and that is correct,
because an `.astro` file's HTML comments are served to the browser (`no-published-credentials.test.ts`
depends on exactly that). Write section comments as `{/* … */}`. But note what the lexer does to one:
`<!-- admin@tokophi.id -->` comes back as `< ! -- admin @ tokophi . id -- >`, so a pattern that must
find a credential in one has to be **whitespace-tolerant**, while the same address inside a string
literal survives as a single token.

⚠️ **A DIRECTORY SKIPPED BY NAME IS THE SAME BLIND SPOT AS A HARDCODED FILE LIST** (found 2026-08-03).
Two repo sweeps skipped any directory called `public`. `apps/<app>/public` is images;
**`apps/admin/app/api/public` is the PUBLIC API** — four route files that neither
`inventory-location.test.ts` nor `no-published-credentials.test.ts` could see, ever. And the worst
instance of the class `inventory-location` hunts lived in exactly one of them: `order/route.ts` held
the sixth copy of the default-location expression, the one with no `store_id` predicate, on the one
path that runs as OWNER with RLS off. Both now skip `public` only at the app root. **Scan everything
and name your exceptions; never bind a guard to a list of targets.**

⚠️ **AND A `*` FOLLOWED BY `/` INSIDE A BLOCK COMMENT CLOSES IT — twice in one day, 2026-08-05.**
Once in `test/source-code.ts` (a comment explaining a comment-splice hole, written literally) and
once in `packages/db/src/seed.ts` (a JSDoc containing the glob `apps/*/app/**`). Both times the
comment ended early and the prose after it became code. The first failed **18 of 50 test files at
import** while the 296 tests that still collected all passed — a green-looking count over a broken
module; the second failed `tsc -p packages/db` with `Cannot find name 'app'`. This file's style is
long explanatory comments full of globs and code samples, so the trap is structural here, not a
slip. **`tsc` and `npm test` both catch it; nothing else does.** Describe the sequence in words, or
put the example in a `//` line comment.

**The sink beats the source.** `packages/lib/src/password.test.ts` scans every tracked source file for
`hashPassword(<arg>)` and fails on a literal, or on an identifier bound to a literal in the same file
— the two shapes that actually shipped (`createStore`, `invitePlatformAdmin`). A mint bound to a name
with no credential word in it (`genSecret`) is invisible to any name-based scanner but still has to
reach the sink. `packages/db/src/seed.ts` is the single named exemption (its fixed password is tracked
as N29); `apps/super-admin/lib/no-fixed-password.test.ts` keeps the stricter local claim — the argument
there must be exactly `pw`, and `pw` must come from the mint.
