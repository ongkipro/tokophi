// Task 6.9 / F-F7 — the kontak page publishes THIS store's email, or nothing.
//
// One storefront container serves EVERY merchant (ADR 0009), so a hardcoded address on this page is
// not a placeholder — it is ONE merchant's inbox published on the contact page of every store on the
// platform. That exact bug shipped once (`const email = "halo@…"` in kontak.astro) and was removed;
// this file pins BOTH halves of the fix now that the page renders the real per-tenant value:
//
//  1. the email the page renders comes from `store.email` (the Host-resolved tenant, migration 0070)
//     and is rendered ONLY behind that store's own value — unset → the row is absent, and
//  2. no email-shaped literal exists anywhere in the text the page can emit — the regression is a
//     one-line "helpful default" and no type-checker, lint or build has an opinion about it.
//
// Views chosen per assertion (test/source-code.ts): the conditional and the `store.email` source are
// things the page EXECUTES → codeOnly. The mailto href and the absence of a literal address are text
// the page EMITS → textWithoutComments, because the address would live INSIDE a string literal, which
// codeOnly inerts — a codeOnly claim here would go permanently green over the exact bug it hunts.
// (`<!-- … -->` is served to the browser and stripped by neither view; kontak.astro's markup comments
// are `{/* … */}` for that reason.)
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { codeOnly, textWithoutComments } from "../../../../test/source-code";

const raw = readFileSync(new URL("../pages/kontak.astro", import.meta.url), "utf8");
const MARKUP = textWithoutComments(raw);
const CODE = codeOnly(raw);

// Anything shaped like a real address in the emitted text. Whitespace-tolerant on purpose: the lexer
// splits an address inside an HTML comment into `name @ host . tld` (see AGENTS.md), and an HTML
// comment is served to the browser, so it must not escape this net either.
const EMAIL_LITERAL = /[A-Za-z0-9._%+-]+\s*@\s*[A-Za-z0-9-]+(?:\s*\.\s*[A-Za-z0-9-]+)*\s*\.\s*[A-Za-z]{2,}/;

describe("kontak — per-store email, honest empty state", () => {
  it("derives the email from the Host-resolved store, never from anywhere else", () => {
    expect(CODE).toMatch(/store\s*\.\s*email/);
  });

  it("renders the email row only when this store published one", () => {
    // The frontmatter normalises blank → null, and the template gates the whole row on it.
    expect(CODE).toMatch(/email\s*&&/);
    // The href is BUILT from that value — `mailto:${email}` — not written out by hand.
    expect(MARKUP).toMatch(/mailto:\s*\$\{\s*email\s*\}/);
  });

  it("emits no email-shaped literal — an unset email is an empty state, not a fallback", () => {
    expect(MARKUP).not.toMatch(EMAIL_LITERAL);
  });

  // Page-map SF-4, same class: opening hours are a per-tenant fact the platform holds no setting
  // for, so the page must not publish a schedule. MARKUP, not CODE — the schedule was plain text.
  it("publishes no opening hours — there is no store setting to derive them from", () => {
    expect(MARKUP).not.toMatch(/Jam\s+Operasional/);
    expect(MARKUP).not.toMatch(/\d\d\.\d\d\s*[–-]\s*\d\d\.\d\d\s*WIB/);
  });

  // ── Mutation self-checks: prove each predicate FIRES on the code it exists to refuse, so the
  //    guard can never be green for want of matching anything (the public-guard.test.ts rule). ──
  it("would go red if a hardcoded fallback address came back", () => {
    const regressed = raw.replace(
      /const email = \(store\.email \?\? ""\)\.trim\(\) \|\| null;/,
      'const email = "halo@contoh-toko.com";',
    );
    expect(regressed, "the mutation no longer matches the source — update this self-check").not.toBe(raw);
    expect(textWithoutComments(regressed)).toMatch(EMAIL_LITERAL);
    expect(codeOnly(regressed)).not.toMatch(/store\s*\.\s*email/);
  });

  it("would go red if the row stopped being conditional", () => {
    const regressed = raw.replace(/email\s*&&/g, "true &&");
    expect(regressed).not.toBe(raw);
    expect(codeOnly(regressed)).not.toMatch(/email\s*&&/);
  });
});
