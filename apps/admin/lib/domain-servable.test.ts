import { describe, expect, it } from "vitest";
import { chainReachesTarget, normaliseHost, servableVerdict } from "./domain-servable";

const T = "cname.tokophi.com";

describe("servableVerdict", () => {
  // THE bug: apex holds hand-copied Cloudflare IPs, so there is no CNAME at all. DNS returns an empty
  // chain (ENODATA), and the old code never looked — it stamped verified_at and rested at provisioning.
  it("refuses a host with no CNAME, and says to remove the IP records", () => {
    const v = servableVerdict([], T);
    expect(v.servable).toBe(false);
    expect(!v.servable && v.message).toMatch(/CNAME/);
    expect(!v.servable && v.message).toMatch(/IP/);
  });

  it("refuses a CNAME pointing somewhere else", () => {
    const v = servableVerdict(["shops.someoneelse.net"], T);
    expect(v.servable).toBe(false);
    expect(!v.servable && v.message).toContain("someoneelse.net");
  });

  it("accepts a CNAME on target", () => expect(servableVerdict([T], T).servable).toBe(true));

  // Resolvers hand back trailing dots and mixed case; neither is a mismatch.
  it.each(["CNAME.Tokophi.com.", "cname.tokophi.com.", "  CNAME.TOKOPHI.COM  "])(
    "accepts %j — trailing dot and case are not mismatches",
    (v) => expect(servableVerdict([v], T).servable).toBe(true),
  );

  it("accepts when the target appears later in a longer chain", () =>
    expect(servableVerdict(["edge.example.net", T], T).servable).toBe(true));

  it("never matches on an empty target", () => expect(chainReachesTarget([""], "")).toBe(false));
  it("normalises", () => expect(normaliseHost(" A.B. ")).toBe("a.b"));
});
