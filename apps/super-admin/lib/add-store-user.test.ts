import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { codeOnly } from "../../../test/source-code";

// `addStoreUser` handed the operator a "new password" for an account it had not touched.
//
// The mint was unconditional (`const pw = tempPassword()`), the HASH was written only inside
// `if (!u)` — the branch that creates a brand-new `users` row — and the return handed `pw` back on
// both paths. So adding an email that already belonged to someone here produced a credential dialog
// showing a well-formed password that had never been hashed into any row. The operator reads it out,
// the merchant tries it, it fails, and nothing on any screen explains why: the string looks right,
// the account exists, and the whole operation reported success.
//
// ⚠️ AND THE OBVIOUS "FIX" IS WORSE. Rehashing on the link path would silently reset the password of
// someone who already staffs another shop — locking them out of THAT store, with no message either.
// `password: null` + a caller that says what happened is the honest shape.
//
// This is a source guard for the same reason `no-fixed-password.test.ts` is one: `actions.ts` is
// `"use server"` and imports `@tokophi/db` at module scope, so it cannot be imported here, and the
// regression is at the CALL SITE rather than in a function anyone could call. Read as **CODE**
// (`test/source-code.ts`) — a comment describing the old shape must not keep this green, which is a
// mistake this repo has already made nine times. Tokens come back space-joined, so patterns are
// written whitespace-tolerantly or compared against `codeOnly("<snippet>")`.
const ACTIONS = codeOnly(readFileSync(new URL("./actions.ts", import.meta.url), "utf8"));
const CALLER = codeOnly(
  readFileSync(new URL("../app/(platform)/toko/[id]/store-detail.tsx", import.meta.url), "utf8"),
);

/**
 * One top-level action's source, from its `export async function` to the next one.
 *
 * ⚠️ NOT brace-matched from the declaration: the first `{` after the name belongs to the PARAMETER
 * object (`input: { name: string; … }`), and the second to the `Promise<{ … }>` return type. Slicing
 * to the next top-level `export` is unambiguous and needs no type-aware parsing.
 */
function actionSource(src: string, name: string): string {
  const opener = `export async function ${name}`;
  const start = src.indexOf(opener);
  expect(start, `${name} not found — this guard is pointed at the wrong file`).toBeGreaterThan(-1);
  const rest = src.slice(start + opener.length);
  const end = rest.indexOf("export async function");
  return end === -1 ? rest : rest.slice(0, end);
}

/** A no-argument local function's body — here the brace after the name IS the body. */
function localFunctionBody(src: string, opener: string): string {
  const start = src.indexOf(opener);
  expect(start, `${opener} not found — this guard is pointed at the wrong file`).toBeGreaterThan(-1);
  return braceBlock(src, src.indexOf("{", start));
}

/** From the `{` at `open` to its matching `}`, inclusive. Braces are their own tokens after `codeOnly`. */
function braceBlock(src: string, open: number): string {
  expect(open, "no block found").toBeGreaterThan(-1);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error("unbalanced braces");
}

const count = (hay: string, needle: string) => hay.split(needle).length - 1;

describe("addStoreUser never reports a credential it did not write", () => {
  const body = actionSource(ACTIONS, "addStoreUser");

  it("mints ONLY inside the branch that writes a password hash — THE DEFECT", () => {
    // The whole bug in one sentence: the mint was outside the `if`, the hash was inside it.
    const guard = codeOnly("if (!u) {").slice(0, -1).trim(); // "if ( ! u ) {" minus the brace, spaced
    const at = body.indexOf(guard);
    expect(at, "the `if (!u)` branch that creates the user is gone — re-read this guard").toBeGreaterThan(-1);
    const branch = braceBlock(body, body.indexOf("{", at + guard.length - 1));

    const mint = codeOnly("tempPassword()");
    expect(count(body, mint), "exactly one mint in this function").toBe(1);
    expect(count(branch, mint), "the mint must live INSIDE the user-creating branch").toBe(1);
    expect(count(branch, codeOnly("hashPassword(")), "…beside the hash it feeds").toBe(1);
  });

  it("declares that the password may be absent", () => {
    // `password?: string` cannot express "there is no new credential" — an optional field that is
    // simply never set reads to a caller exactly like one the action forgot. `| null` is the claim.
    const sig = /export\s+async\s+function\s+addStoreUser\s*\([^)]*\)\s*:\s*Promise\s*<([^>]*)>/.exec(ACTIONS);
    expect(sig, "addStoreUser not found").not.toBeNull();
    expect(sig![1]).toMatch(/password\s*\?\s*:\s*string\s*\|\s*null/);
    expect(sig![1], "the caller needs to be told WHICH of the two happened").toMatch(/outcome\s*\?\s*:/);
  });
});

describe("the caller reports what actually happened", () => {
  // Converting a return shape is a TWO-file change (CLAUDE.md): a caller that ignores the new field
  // reports success over something that did not happen. Here that means announcing a password
  // handover on the path where no password was handed over.
  const body = localFunctionBody(CALLER, "function submitAddUser");

  it("branches on the outcome", () => {
    expect(body).toContain(codeOnly('r.outcome === "created"'));
  });

  it("says something DIFFERENT on each path", () => {
    const messages = [...body.matchAll(/toast\s*\.\s*success\s*\(\s*("[^"]*")/g)].map((m) => m[1]);
    expect(messages.length, "one message for `created`, one for `linked`").toBe(2);
    expect(new Set(messages).size, "two paths reporting the same sentence is the bug wearing a fix").toBe(2);
  });

  it("only reveals a credential on the path that created one", () => {
    const reveal = body.indexOf(codeOnly("setCred("));
    const branch = body.indexOf(codeOnly('r.outcome === "created"'));
    expect(count(body, codeOnly("setCred(")), "one reveal, on one path").toBe(1);
    expect(reveal, "the credential dialog must sit behind the outcome check").toBeGreaterThan(branch);
  });
});
