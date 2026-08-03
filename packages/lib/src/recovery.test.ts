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
    expect(await verifyRecoveryToken(token.slice(0, -1) + "X", STORE)).toBeNull();
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
