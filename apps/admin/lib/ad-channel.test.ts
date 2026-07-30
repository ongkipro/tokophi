import { describe, it, expect } from "vitest";
import { adChannel } from "./ad-channel";

// `orders.channel` is what the whole Pemasaran attribution screen counts. Its only writer used to
// hard-code "organic", so these are the first assertions that it means anything at all.
describe("adChannel — paid attribution from the buyer's own browser", () => {
  const fbc = (ms: number) => `fb.1.${ms}.IwAR0abcdef`;
  const gcl = (sec: number) => `GCL.${sec}.EAIaIQobChMI`;
  // A fixed "now" so these assertions do not rot: the click ids below are minutes old relative to it.
  const NOW = 1_760_000_000_000;
  const DAY = 86_400_000;

  it("is organic when nothing points anywhere", () => {
    expect(adChannel(undefined, NOW)).toBe("organic");
    expect(adChannel({}, NOW)).toBe("organic");
  });

  describe("fbclid is NOT proof of an ad — Meta appends it to organic links too", () => {
    it("books a bare _fbc as `other`, never meta_ads", () => {
      // A shopper tapping the merchant's own Instagram bio link carries an _fbc. Counting that as ad
      // revenue is exactly the kind of flattering fiction this column was fixed to stop producing.
      expect(adChannel({ fbc: fbc(NOW) }, NOW)).toBe("other");
    });

    it("books it as meta_ads once the merchant tags the ad URL as paid", () => {
      expect(adChannel({ fbc: fbc(NOW), utmSource: "facebook", utmMedium: "cpc" }, NOW)).toBe("meta_ads");
      expect(adChannel({ utmSource: "Instagram", utmMedium: "paid_social" }, NOW)).toBe("meta_ads");
    });

    it("does not let an organic UTM promote it", () => {
      expect(adChannel({ fbc: fbc(NOW), utmSource: "facebook", utmMedium: "social" }, NOW)).toBe("other");
    });
  });

  describe("gclid and ttclid really are paid-only, so they stand alone", () => {
    it("reads a Google Ads click id", () => {
      expect(adChannel({ gcl: gcl(NOW / 1000) }, NOW)).toBe("google_ads");
    });

    it("reads Google's iOS fallbacks (gbraid / gs), which carry no timestamp", () => {
      // Without these, iOS Google Ads traffic is booked organic — under-reporting Google on the traffic
      // mix where it is hardest to measure in the first place.
      expect(adChannel({ gcl: "GB.1.abcdefgh" }, NOW)).toBe("google_ads");
      expect(adChannel({ gcl: "GS.1.abcdefgh" }, NOW)).toBe("google_ads");
    });

    it("reads a TikTok click id", () => {
      expect(adChannel({ ttclid: "E.C.P.abcdef" }, NOW)).toBe("tiktok_ads");
    });
  });

  describe("the 30-day window", () => {
    it("ignores a Google click id older than the window", () => {
      // `_gcl_aw` lives 90 days. Without a window one click in May relabels every order until August.
      expect(adChannel({ gcl: gcl((NOW - 29 * DAY) / 1000) }, NOW)).toBe("google_ads");
      expect(adChannel({ gcl: gcl((NOW - 31 * DAY) / 1000) }, NOW)).toBe("organic");
    });

    it("ignores an _fbc older than the window", () => {
      expect(adChannel({ fbc: fbc(NOW - 29 * DAY) }, NOW)).toBe("other");
      expect(adChannel({ fbc: fbc(NOW - 31 * DAY) }, NOW)).toBe("organic");
    });
  });

  describe("precedence", () => {
    it("lets paid tagging beat every cookie", () => {
      expect(adChannel({ gcl: gcl(NOW / 1000), utmSource: "tiktok", utmMedium: "cpc" }, NOW)).toBe("tiktok_ads");
    });

    it("books paid traffic from a network we do not model as `other`, not organic", () => {
      expect(adChannel({ utmSource: "shopee", utmMedium: "cpc" }, NOW)).toBe("other");
    });

    it("prefers a paid click id over a bare Meta referral", () => {
      expect(adChannel({ fbc: fbc(NOW), ttclid: "E.C.P.x" }, NOW)).toBe("tiktok_ads");
      expect(adChannel({ fbc: fbc(NOW), gcl: gcl(NOW / 1000) }, NOW)).toBe("google_ads");
    });
  });

  it("ignores _fbp and _ttp — they are set on ANY visit, not on an ad click", () => {
    // Treating them as attribution would relabel most organic traffic as paid.
    expect(adChannel({ fbc: "", gcl: "", ttclid: "" }, NOW)).toBe("organic");
    expect(adChannel({ fbc: "fb.1.notatimestamp.x" }, NOW)).toBe("organic");
    expect(adChannel({ gcl: "GCL.short.x" }, NOW)).toBe("organic");
  });
});
