import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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

const CHECKOUT = fileURLToPath(new URL("./data/checkout.ts", import.meta.url));
const CART_MESSAGE = fileURLToPath(new URL("./cart-message.ts", import.meta.url));

describe("the abandoned-cart recovery link is wired, not merely defined", () => {
  const src = readFileSync(CHECKOUT, "utf8");

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
    expect(src).toMatch(/recoveryUrl\(\s*host\s*,\s*r\.storeId\s*,\s*r\.sessionId\s*\)/);
  });

  it("puts the link INTO the WhatsApp message the merchant sends", () => {
    // A minted link that never reaches the message body is the same bug wearing a different hat.
    expect(src).toMatch(/cartMessage\([^)]*\blink\b[^)]*\)/);
    expect(src).toMatch(/waLink\(\s*r\.phone\s*,\s*cartMessage\(/);
  });

  it("cartMessage appends the link when the template has no {{link}} — which is every live store", () => {
    // The seed is not a migration: no existing store's template body carries the placeholder, so
    // substitution alone would ship a fix that changes nothing for a single real merchant.
    const cm = readFileSync(CART_MESSAGE, "utf8");
    expect(cm).toMatch(/templateBody\.includes\("\{\{link\}\}"\)/);
  });
});
