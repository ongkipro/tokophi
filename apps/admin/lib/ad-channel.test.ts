import { describe, it, expect } from "vitest";
import { adChannel } from "./ad-channel";

// `orders.channel` is what the whole Pemasaran attribution screen counts. It was hard-coded to
// "organic" by its only writer, so these are the first assertions that it means anything at all.
describe("adChannel — last ad click from the browser's own click ids", () => {
  const fbc = (ms: number) => `fb.1.${ms}.IwAR0abcdef`;
  const gcl = (sec: number) => `GCL.${sec}.EAIaIQobChMI`;

  it("is organic when nothing points at an ad", () => {
    expect(adChannel(undefined)).toBe("organic");
    expect(adChannel({})).toBe("organic");
  });

  it("reads a Meta click id", () => {
    expect(adChannel({ fbc: fbc(1_760_000_000_000) })).toBe("meta_ads");
  });

  it("reads a Google Ads click id", () => {
    expect(adChannel({ gcl: gcl(1_760_000_000) })).toBe("google_ads");
  });

  it("reads a TikTok click id", () => {
    expect(adChannel({ ttclid: "E.C.P.abcdef" })).toBe("tiktok_ads");
  });

  it("takes the MOST RECENT click when two platforms both claim it", () => {
    // The unit trap: `_fbc` is milliseconds and `_gcl_aw` is seconds. Compared raw, the Google
    // timestamp is ~1000× smaller and Meta wins every single time.
    const meta = 1_760_000_000_000; // ms
    const laterGoogle = 1_760_000_600; // seconds — ten minutes AFTER the Meta click
    expect(adChannel({ fbc: fbc(meta), gcl: gcl(laterGoogle) })).toBe("google_ads");
    const earlierGoogle = 1_759_999_400;
    expect(adChannel({ fbc: fbc(meta), gcl: gcl(earlierGoogle) })).toBe("meta_ads");
  });

  it("lets a timestamped click beat TikTok's untimestamped one", () => {
    expect(adChannel({ fbc: fbc(1_760_000_000_000), ttclid: "E.C.P.x" })).toBe("meta_ads");
  });

  it("ignores _fbp and _ttp — they are set on ANY visit, not on an ad click", () => {
    // Treating them as attribution would relabel most organic traffic as paid.
    expect(adChannel({ fbc: "", gcl: "", ttclid: "" })).toBe("organic");
    expect(adChannel({ fbc: "fb.1.notatimestamp.x" })).toBe("organic");
    expect(adChannel({ gcl: "GCL.short.x" })).toBe("organic");
  });
});
