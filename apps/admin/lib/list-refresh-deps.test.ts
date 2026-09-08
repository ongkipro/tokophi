import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { codeOnly } from "../../../test/source-code";

// A LIST SCREEN MUST RE-FILTER WHEN `router.refresh()` HANDS IT NEW SERVER PROPS.
//
// ── the defect this exists for ────────────────────────────────────────────────────────────────────
//
// Every admin list screen is a Server Component that reads the rows and a `*-client.tsx` that filters
// them. A delete is a server action followed by `router.refresh()`. `router.refresh()` re-renders the
// client component with FRESH PROPS but does NOT remount it — so a `useMemo` whose dependency array
// lists only the local filter state (`[query, status]`) never recomputes, and the deleted row stays on
// the screen under a "dihapus" toast until someone reloads by hand. The DB row is gone; the table
// disagrees. Driven in a browser 2026-09-08 (`specs/docs/tasks/2026-09-08-browser-verification.md`):
// still on screen at 1 s, 3 s, 5 s and 8 s.
//
// It has now been found in six files. `diskon-client.tsx` fixed it and wrote the reason down; the two
// screens beside it were left broken for weeks, and `blog-client.tsx` was broken and correct in the
// SAME COMPONENT — its `counts` memo listed `posts` while its `filtered` memo did not, so the tab
// counter dropped and the table did not. That is the shape a guard is for.
//
// ── the claim, stated narrowly ────────────────────────────────────────────────────────────────────
//
//   For every `*-client.tsx` under `apps/admin/app/(admin)/`: if a `useMemo` callback reads an
//   identifier that the enclosing component destructured out of its props, that identifier must
//   appear in the memo's dependency array.
//
// It is deliberately not "array props only". A scalar prop read by a memo has the same staleness, and
// restricting to `T[]` would need the prop's TYPE, which goes blind the moment somebody writes
// `function X({ posts }: Props)` instead of an inline annotation. Measured on the tree of 2026-09-08:
// the wide rule and the array-only rule flag exactly the same set, so the wide one costs nothing today
// and keeps working after a type alias.
//
// What it does NOT claim: nothing about `useEffect`/`useCallback` (this is a rendering-staleness bug,
// not a subscription one), nothing about identifiers that are not props, and nothing about a memo with
// no dependency array at all (that recomputes every render — wasteful, never stale).
//
// ── why the AST, when the house rule is `codeOnly()` ──────────────────────────────────────────────
//
// `test/source-code.ts` exists because a guard must assert against a file's CODE and never its TEXT: a
// commented-out line and a line inside a string literal both LOOK like code to a regex. Both hazards
// are live here — `// }, [query, status, pages]);` in a comment would satisfy any substring match.
//
// The reason those guards lex instead of parse is that their targets are `.astro` files, which are not
// TypeScript programs. These are `.tsx`, so the full parser is available, and it subsumes the lexer's
// two guarantees (a comment is trivia and never becomes a node; a string literal is a node that can
// never masquerade as a dependency array) while additionally giving the one thing a token stream
// cannot: the STRUCTURE of a dependency array, so "is `pages` in the deps" is a question about
// elements, not about characters appearing somewhere near each other.
//
// `codeOnly` is still imported, and it is not decoration: the self-check below uses it to show that the
// obvious text-shaped version of this rule is GREEN on a file this one correctly fails.

const ADMIN_ROOT = resolve(__dirname, "..", "app", "(admin)");
const REPO_ROOT = resolve(__dirname, "..", "..", "..");

/** Every `*-client.tsx` under the route group, walked off the DIRECTORY — never a hand-kept list. */
function clientFiles(dir = ADMIN_ROOT): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...clientFiles(p));
    else if (e.name.endsWith("-client.tsx")) out.push(p);
  }
  return out.sort();
}

type Violation = {
  file: string;
  line: number;
  prop: string;
  deps: string;
};

/**
 * Every memo in `src` that reads a destructured prop, with the props it reads and the props its
 * dependency array lists. `src` is parsed, so comments and string literals cannot contribute.
 */
function violations(file: string, source: string): Violation[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: Violation[] = [];

  const isMemo = (call: ts.CallExpression) => {
    const t = call.expression;
    if (ts.isIdentifier(t)) return t.text === "useMemo";
    return ts.isPropertyAccessExpression(t) && t.name.text === "useMemo";
  };

  /** Identifier reads inside `node` that name one of `props` — property NAMES (`x.posts`) excluded. */
  function propsRead(node: ts.Node, props: ReadonlySet<string>): Set<string> {
    const hit = new Set<string>();
    (function walk(n: ts.Node) {
      if (ts.isIdentifier(n) && props.has(n.text)) {
        const p = n.parent;
        const isMemberName = ts.isPropertyAccessExpression(p) && p.name === n;
        const isPropertyKey = ts.isPropertyAssignment(p) && p.name === n;
        if (!isMemberName && !isPropertyKey) hit.add(n.text);
      }
      n.forEachChild(walk);
    })(node);
    return hit;
  }

  function scanComponent(fn: ts.SignatureDeclaration, props: ReadonlySet<string>) {
    (function walk(n: ts.Node) {
      if (ts.isCallExpression(n) && isMemo(n)) {
        const [cb, deps] = n.arguments;
        // No dependency array ⇒ recomputes every render ⇒ never stale. Not this rule's business.
        if (cb && deps && ts.isArrayLiteralExpression(deps)) {
          const listed = new Set(deps.elements.map((e) => e.getText(sf)));
          for (const prop of propsRead(cb, props)) {
            if (!listed.has(prop)) {
              found.push({
                file: relative(REPO_ROOT, file),
                line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
                prop,
                deps: deps.getText(sf),
              });
            }
          }
        }
      }
      n.forEachChild(walk);
    })(fn);
  }

  (function scan(n: ts.Node) {
    if (
      (ts.isFunctionDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n)) &&
      n.parameters.length > 0 &&
      n.body
    ) {
      const first = n.parameters[0].name;
      if (ts.isObjectBindingPattern(first)) {
        const props = new Set(
          first.elements.map((el) => (ts.isIdentifier(el.name) ? el.name.text : "")).filter(Boolean),
        );
        if (props.size > 0) scanComponent(n, props);
      }
    }
    n.forEachChild(scan);
  })(sf);

  return found;
}

describe("admin list screens re-filter after router.refresh()", () => {
  const files = clientFiles();

  // A guard bound to nothing is green forever. Both floors are measured, not guessed: 33 client
  // components on 2026-09-08, 12 of them carrying a prop-reading memo.
  it("actually has files and memos to check", () => {
    expect(files.length).toBeGreaterThanOrEqual(30);
    const withMemo = files.filter((f) => {
      const sf = ts.createSourceFile(f, readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      let n = 0;
      (function walk(x: ts.Node) {
        if (ts.isCallExpression(x)) {
          const t = x.expression;
          const name = ts.isIdentifier(t) ? t.text : ts.isPropertyAccessExpression(t) ? t.name.text : "";
          if (name === "useMemo") n++;
        }
        x.forEachChild(walk);
      })(sf);
      return n > 0;
    });
    expect(withMemo.length).toBeGreaterThanOrEqual(10);
  });

  it.each(files.map((f) => [relative(REPO_ROOT, f), f] as const))(
    "%s — every prop a useMemo reads is in its deps",
    (_name, file) => {
      const bad = violations(file, readFileSync(file, "utf8"));
      expect(
        bad.map((v) => `line ${v.line}: memo reads prop \`${v.prop}\` but deps are ${v.deps}`),
      ).toEqual([]);
    },
  );

  // ── the guard proved RED, and the text-shaped version proved USELESS ────────────────────────────
  //
  // The mutation is the real defect, on a COPY of the file it was fixed in — product source is never
  // edited to test a guard (another stream may own it, and a half-reverted file is worse than no test).
  it("fires on the halaman defect, and a substring rule does not", () => {
    const path = join(ADMIN_ROOT, "halaman", "halaman-client.tsx");
    const clean = readFileSync(path, "utf8");
    expect(violations(path, clean)).toEqual([]);

    // 1. the dependency simply removed — what shipped.
    const removed = clean.replace("}, [query, status, pages]);", "}, [query, status]);");
    expect(removed).not.toBe(clean);
    expect(violations(path, removed).map((v) => v.prop)).toEqual(["pages"]);

    // 2. the dependency present only as a COMMENT. This is the case `codeOnly()` was written for, and
    //    the case a naive rule gets wrong: the characters `pages]` are still in the file.
    const commented = clean.replace("}, [query, status, pages]);", "}, [query, status /*, pages */]);");
    expect(commented).not.toBe(clean);
    expect(violations(path, commented).map((v) => v.prop)).toEqual(["pages"]);

    // …and here is the rule NOT used, failing, so the choice above is evidence rather than assertion.
    // `codeOnly` correctly inerts the comment, but a substring rule cannot tell a dependency array
    // from any other place the word appears — `pages.filter(` in the memo body satisfies it.
    const naive = (src: string) => codeOnly(src).includes("pages");
    expect(naive(clean)).toBe(true);
    expect(naive(removed)).toBe(true); // green on the shipped bug.
  });
});
