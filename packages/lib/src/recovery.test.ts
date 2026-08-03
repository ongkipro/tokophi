import { describe, expect, it } from "vitest";
import { recoveryUrl, signRecoveryToken, verifyRecoveryToken } from "./recovery";

// The two halves of the recovery link, pinned together.
//
// They were written in one file, in the storefront, and only the VERIFY half ever ran: the admin
// could not import the module, so `signRecoveryToken` had zero callers and no link was ever minted.
// Nothing failed — the checkout simply never restored, and four docs recorded the feature as working.
//
// So the round trip is the test worth having: sign here, verify here, and assert the three ways a
// link must be REFUSED. A regression in either half is silent in production (a link that does not
// restore looks exactly like a shopper who changed their mind).

const STORE = "908695b5-abf0-44a3-8241-b984d9e68aaa";
const OTHER = "60edbc83-93f8-4859-b689-369491f9ec26";
const SID = "ck-10-0-350";

describe("recovery token", () => {
  it("round-trips: what is signed for a store verifies for that store", async () => {
    const token = await signRecoveryToken(STORE, SID);
    expect(await verifyRecoveryToken(token, STORE)).toBe(SID);
  });

  it("is STORE-BOUND — a token minted for another tenant is refused", async () => {
    // The secret is shared across tenants, so this predicate is the only thing stopping one store's
    // link from restoring a cart on another store's host.
    const token = await signRecoveryToken(OTHER, SID);
    expect(await verifyRecoveryToken(token, STORE)).toBeNull();
  });

  it("refuses a tampered signature", async () => {
    const token = await signRecoveryToken(STORE, SID);
    // ⚠️ DO NOT TAMPER THE LAST CHARACTER. It was `token.slice(0, -1) + "X"`, and that made this suite
    // fail ~7,5% of runs with "expected 'ck-10-0-350' to be null" — the token still verified.
    //
    // An HS256 signature is 32 bytes = 256 bits, and base64url carries 6 bits per character: 43
    // characters, of which the last holds only 256 − 42×6 = 4 significant bits. Its low two bits are
    // padding, so FOUR different characters decode to the same signature bytes. "Change the last
    // character" is not a tamper — it is a coin flip.
    //
    // The first character of the signature carries all six bits, so changing it always changes the
    // bytes. Assert on that, and pick a replacement that differs from what is there.
    const [h, p, sig] = token.split(".");
    const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
    expect(flipped).not.toBe(sig);
    expect(await verifyRecoveryToken(`${h}.${p}.${flipped}`, STORE)).toBeNull();
  });

  it("NEVER THROWS on junk — a bad link must render an empty checkout, not a 500", async () => {
    for (const junk of ["", "not-a-jwt", "a.b.c", "../../etc/passwd"]) {
      await expect(verifyRecoveryToken(junk, STORE)).resolves.toBeNull();
    }
  });

  it("builds a URL the storefront actually routes: /checkout?r=<token>", async () => {
    const url = await recoveryUrl("batik-nusantara.tokophi.id", STORE, SID);
    const u = new URL(url);
    expect(u.protocol).toBe("https:"); // never http — the token is a credential in a query string
    expect(u.host).toBe("batik-nusantara.tokophi.id");
    expect(u.pathname).toBe("/checkout");
    // Round-trips after URL parsing — i.e. it survived encodeURIComponent and the query split.
    expect(await verifyRecoveryToken(u.searchParams.get("r")!, STORE)).toBe(SID);
  });
});
