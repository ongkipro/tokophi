// THE DISTRICT SEARCH HAS FIVE STATES, AND THREE OF THEM USED TO LOOK IDENTICAL (Task 5.4 / F-F10).
//
// idle · loading · results · empty · failure. Before this, an EMPTY answer only closed the list, a
// non-ok JSON reply was folded into the same silence, and a request had no ceiling — so a shopper
// typing a real district that is not in our snapshot, a shopper on a dead proxy, and a shopper whose
// request was still in flight all saw the same thing: nothing, on the one field the ongkir quote
// depends on. The script is inline in `checkout.astro`, so there is nothing to import and call; this
// is a source-level guard in the shape of `checkout-kodepos.test.ts`, and the behaviour itself is
// driven in a browser (see BUILD-LOG 2026-09-08, Task 5.4).
//
// `codeOnly`, not text: every claim here is about what the script EXECUTES. A commented-out
// `setDestNotice(...)` must not keep this green — that exact defect has been found nine times in
// this repo. Write the patterns whitespace-tolerantly: the lexer joins tokens with single spaces.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { codeOnly, textWithoutComments } from "../../../../test/source-code";

const raw = readFileSync(new URL("../pages/checkout.astro", import.meta.url), "utf8");
const CODE = codeOnly(raw);
const MARKUP = textWithoutComments(raw);
// The whole search handler, from the debounce to the click handler on the results list.
const SEARCH = CODE.match(/searchTimer\s*=\s*setTimeout\s*\([\s\S]*?destResults\s*\.\s*addEventListener/)?.[0] ?? "";

describe("checkout district search — failure, empty and loading are three different rows", () => {
  it("a successful EMPTY answer renders the 'tidak ditemukan' state, with the query escaped", () => {
    // `codeOnly` keeps a literal's WORDS and turns its punctuation into `·`, so the claim can be
    // made on the code view alone: the call is on the empty branch, `esc()` wraps what the shopper
    // typed, and the sentence is the one the task names — and a commented-out copy cannot match.
    expect(SEARCH).toMatch(
      /results\s*\.\s*length\s*\)\s*\{\s*setDestNotice\s*\(\s*"Kecamatan[·\s]*"\s*\+\s*esc\s*\(\s*qAtCall\s*\)\s*\+\s*"[·\s]*tidak·ditemukan\.·Coba·ejaan·lain·atau·nama·kota\./,
    );
  });

  it("the request is bounded by an AbortController with a timeout, and the timeout lands in the failure row", () => {
    expect(SEARCH).toMatch(/new\s+AbortController\s*\(\s*\)/);
    expect(SEARCH).toMatch(/setTimeout\s*\(\s*function\s*\(\s*\)\s*\{\s*if\s*\(\s*ctl\s*\)\s*ctl\s*\.\s*abort\s*\(\s*\)/);
    expect(CODE).toMatch(/SEARCH_TIMEOUT_MS\s*=\s*10000/);
    // The signal actually reaches the fetch — a controller nobody passes bounds nothing.
    expect(SEARCH).toMatch(/api\s*\(\s*\{[^}]*op\s*:\s*"search"[^}]*\}\s*,\s*ctl\s*\?\s*ctl\s*\.\s*signal/);
    expect(CODE).toMatch(/function\s+api\s*\(\s*payload\s*,\s*signal\s*\)[\s\S]{0,300}?signal\s*:\s*signal/);
  });

  it("a stale response never paints over a newer query — compared against the box at call time", () => {
    // Mirrors `destAtCall` in loadRates()/loadKelurahan(): capture at call time, compare on return.
    expect(SEARCH).toMatch(/var\s+qAtCall\s*=\s*q\b/);
    expect(SEARCH).toMatch(/destSearch\s*\.\s*value\s*\.\s*trim\s*\(\s*\)\s*!==\s*qAtCall/);
    // Both the success and the failure branch CONSULT it — a definition nobody calls guards nothing.
    const consulted = SEARCH.match(/if\s*\(\s*stale\s*\(\s*\)\s*\)\s*return/g) ?? [];
    expect(consulted.length, "the success branch and the failure branch each consult stale()").toBe(2);
  });

  it("every non-result row is a disabled option — the listbox a11y contract holds", () => {
    // MARKUP claims, so the markup view: the listbox label is an attribute the page emits, and the
    // notice row is markup concatenated into a JS string (the same shape as the search palette).
    expect(MARKUP).toMatch(/aria\s*-\s*label\s*=\s*"Hasil pencarian kecamatan"/);
    expect(MARKUP).toMatch(/function\s+setDestNotice\s*\([\s\S]{0,400}?role="option" aria-disabled="true"/);
    // And the loading state goes through it — a bare "Mencari" outside the writer would be a <p>.
    expect(SEARCH).toMatch(/setDestNotice\s*\(\s*"Mencari/);
  });
});
