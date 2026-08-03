import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { codeOnly } from "../../../test/source-code";

// THE MINT MUST HAVE A CALLER. That is the entire bug this guards.
//
// `signRecoveryToken` existed, was correct, was documented in four places as working — and had ZERO
// callers in all four apps for as long as the feature had existed. Every downstream piece (the
// verifier, the "Selamat datang kembali" banner, the basket restore, the field pre-fill) was live
// code that could never run, because nothing ever produced a link to trigger it.
//
// No unit test could see that: each half passes its own tests in isolation. What was missing was the
// WIRE, so the wire is what is asserted here. Delete the call and the feature silently returns to
// being ~50 lines of unreachable storefront code with a green build.
//
// Read as source, not imported, because `lib/data/checkout.ts` pulls `@tokophi/db` at module scope
// (needing a live DATABASE_URL) and the fact under test is structural, not behavioural.
//
// ⚠️ IT IS THE FILE'S **CODE** THAT IS READ (`test/source-code.ts`), NEVER ITS TEXT — and this file
// was `cart-variant.test.ts`'s exact twin in the way that mattered: it matched the RAW source, so
// every claim below was one `// ` away from being green over a dead feature. Measured: commenting out
// the `recoveryUrl(...)` line and the `cartMessage(` inside `waHref` — the two calls this whole file
// exists to pin — left all four tests passing, i.e. exactly the outage it was written to prevent,
// reported as fixed.
//
// `codeOnly` is the right half of the pair here and `textWithoutComments` would be wrong: every claim
// below is about what `getAbandonedCarts` EXECUTES. A `recoveryUrl(host, r.storeId, r.sessionId)`
// inside a string or a doc-comment mints nothing. (The markup exception belongs to `h1-floor`, whose
// claim is about emitted HTML.)
//
// Tokens come back joined by single spaces, so the patterns are whitespace-tolerant: `r\s*\.\s*phone`,
// never `r\.phone`.
const CHECKOUT = fileURLToPath(new URL("./data/checkout.ts", import.meta.url));

describe("the abandoned-cart recovery link is wired, not merely defined", () => {
  const src = codeOnly(readFileSync(CHECKOUT, "utf8"));

  it("getAbandonedCarts imports the mint from the SHARED module", () => {
    // `@tokophi/lib/recovery`, never a re-implementation and never the storefront's path (which the
    // admin cannot resolve — that unreachable import is the original defect).
    expect(src).toMatch(/import\s*\{[^}]*\brecoveryUrl\b[^}]*\}\s*from\s*"@tokophi\/lib\/recovery"/);
    expect(src).not.toContain("storefront/src/lib/recovery");
  });

  it("actually calls it, and passes the SESSION id — not the row id", () => {
    // `checkout_sessions.id` is the primary key; the storefront looks the row up by `session_id`.
    // Passing `r.id` mints a token that verifies fine and then matches no row: a link that opens an
    // empty checkout, with nothing anywhere saying why.
    expect(src).toMatch(/recoveryUrl\s*\(\s*host\s*,\s*r\s*\.\s*storeId\s*,\s*r\s*\.\s*sessionId\s*\)/);
  });

  it("puts the link INTO the WhatsApp message the merchant sends", () => {
    // A minted link that never reaches the message body is the same bug wearing a different hat.
    expect(src).toMatch(/cartMessage\s*\([^)]*\blink\b[^)]*\)/);
    expect(src).toMatch(/waLink\s*\(\s*r\s*\.\s*phone\s*,\s*cartMessage\s*\(/);
  });

  // The fourth claim this file used to make — "cartMessage appends the link when the template has no
  // {{link}}, which is every live store" — was a grep for `templateBody.includes("{{link}}")` and it
  // is GONE, not converted. Two reasons, and the first is the ladder in AGENTS.md: `cart-message.ts`
  // is pure and imported, so `cart-message.test.ts` already asserts the OUTCOME on both branches
  // (appends when the placeholder is absent, substitutes exactly once when present, never emits a
  // literal `{{link}}`). Reading source is the fallback for a claim about ABSENCE; here there was a
  // function to call. The second is that the grep was the weaker of the two even before that:
  // commenting the line out left it green, and under `codeOnly` the placeholder's own punctuation is
  // inert (`"··link··"`), so the converted version could no longer tell `{{link}}` from `[[link]]`.
});
