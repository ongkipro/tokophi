import { describe, expect, it } from "vitest";
import { CLOSED_PAGE, HEALTH_PATH, affiliateOrigin, closedRewrite } from "./availability";
import { safeNext, slugFromInput } from "./nav";

// The dormant switch (ADR 0022): AFFILIATE_APP_URL unset ⇒ every path is the "belum dibuka" page,
// except the healthcheck (Traefik needs a healthy server for the host) and that page itself.
describe("affiliate availability", () => {
  const OPEN = { AFFILIATE_APP_URL: "https://affiliate.tokophi.com" };

  it("closed when the switch is unset, empty, or not a bare origin", () => {
    for (const v of [undefined, "", "  ", "affiliate.tokophi.com", "https://affiliate.tokophi.com/x", "https://u:p@affiliate.tokophi.com"]) {
      expect(affiliateOrigin({ AFFILIATE_APP_URL: v }, true), String(v)).toBeNull();
      expect(closedRewrite("/", { AFFILIATE_APP_URL: v }, true), String(v)).toBe(CLOSED_PAGE);
      expect(closedRewrite("/masuk", { AFFILIATE_APP_URL: v }, true)).toBe(CLOSED_PAGE);
    }
  });

  it("the healthcheck and the closed page itself are never rewritten", () => {
    expect(closedRewrite(HEALTH_PATH, {}, true)).toBeNull();
    expect(closedRewrite(CLOSED_PAGE, {}, true)).toBeNull();
  });

  it("open with an https origin (trailing slash tolerated); plain http only outside a production build", () => {
    expect(affiliateOrigin({ AFFILIATE_APP_URL: "https://affiliate.tokophi.com/" }, true)).toBe("https://affiliate.tokophi.com");
    expect(closedRewrite("/", OPEN, true)).toBeNull();
    expect(affiliateOrigin({ AFFILIATE_APP_URL: "http://localhost:4330" }, true)).toBeNull();
    expect(affiliateOrigin({ AFFILIATE_APP_URL: "http://localhost:4330" }, false)).toBe("http://localhost:4330");
  });
});

describe("navigation helpers", () => {
  it("safeNext keeps same-origin paths only", () => {
    expect(safeNext("/toko/abc?x=1")).toBe("/toko/abc?x=1");
    for (const bad of [null, "", "https://evil.example", "//evil.example", "/\t/evil.example", "javascript:alert(1)"]) {
      expect(safeNext(bad), String(bad)).toBe("/");
    }
  });
  it("slugFromInput accepts a slug, a store host and a pasted URL", () => {
    expect(slugFromInput("batiknusantara")).toBe("batiknusantara");
    expect(slugFromInput(" BatikNusantara.tokophi.id ")).toBe("batiknusantara");
    expect(slugFromInput("https://batiknusantara.tokophi.id/produk/x?ref=A")).toBe("batiknusantara");
  });
});
