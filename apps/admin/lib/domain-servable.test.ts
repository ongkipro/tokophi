import { describe, expect, it } from "vitest";
import { chainReachesTarget, normaliseHost, servableVerdict } from "./domain-servable";

// Arbitrary on purpose — the function takes the target as an argument, so hard-coding the REAL one
// here would let a future change to CNAME_TARGET pass unnoticed. (It is `cname.tokophi.cc`.)
const T = "cname.example.test";

describe("servableVerdict", () => {
  // THE bug: apex holds hand-copied Cloudflare IPs, so there is no CNAME at all. DNS returns an empty
  // chain (ENODATA), and the old code never looked — it stamped verified_at and rested at provisioning.
  // no-cname is UNDECIDABLE, not wrong: an apex cannot hold a CNAME, and flattening resolves as A
  // records identical to the copied-IP mistake. The verdict must say so and route to Cloudflare —
  // the hard refusal here is what told a correctly-configured merchant to do the impossible.
  it("marks an empty chain no-cname, with guidance covering BOTH the subdomain and the apex", () => {
    const v = servableVerdict([], T);
    expect(v.servable).toBe(false);
    expect(!v.servable && v.kind).toBe("no-cname");
    expect(!v.servable && v.message).toMatch(/CNAME/);
    expect(!v.servable && v.message).toMatch(/ANAME|ALIAS|flattening/);
    expect(!v.servable && v.message).toContain(T);
  });

  it("refuses a CNAME pointing somewhere else — the one case DNS can prove", () => {
    const v = servableVerdict(["shops.someoneelse.net"], T);
    expect(v.servable).toBe(false);
    expect(!v.servable && v.kind).toBe("wrong-target");
    expect(!v.servable && v.message).toContain("someoneelse.net");
  });

  it("accepts a CNAME on target", () => expect(servableVerdict([T], T).servable).toBe(true));

  // Resolvers hand back trailing dots and mixed case; neither is a mismatch.
  it.each(["CNAME.Example.test.", "cname.example.test.", "  CNAME.EXAMPLE.TEST  "])(
    "accepts %j — trailing dot and case are not mismatches",
    (v) => expect(servableVerdict([v], T).servable).toBe(true),
  );

  it("accepts when the target appears later in a longer chain", () =>
    expect(servableVerdict(["edge.example.net", T], T).servable).toBe(true));

  it("never matches on an empty target", () => expect(chainReachesTarget([""], "")).toBe(false));
  it("normalises", () => expect(normaliseHost(" A.B. ")).toBe("a.b"));
});
