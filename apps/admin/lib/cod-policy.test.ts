import { describe, it, expect } from "vitest";
import { buildCodPolicy, normProvince, type CodPolicyInput } from "./cod-policy";

// The COD gate — "the ONE place that answers may this order be paid on delivery?". Five switches must
// ALL agree; /api/public/order rejects a COD order that fails any of them, so this is a money boundary,
// not UX. Each condition below is one the code learned by shipping the wrong thing: the cap and the
// province list were once stored and read nowhere (they bounded nothing), and every non-SPX courier is
// codAllowed=false even where KiriminAja reports cod=true.

// A store where COD is fully available: platform on, store on, Rp2jt cap, 6 provinces, SPX carries it.
const base: CodPolicyInput = {
  storeCodEnabled: true,
  platformCod: {
    enabled: true,
    maxAmountIdr: 2_000_000,
    allowedProvinces: ["DI Yogyakarta", "Jawa Tengah", "Jawa Barat", "DKI Jakarta", "Banten", "Jawa Timur"],
  },
  couriers: [
    { courier: "spx", enabled: true, services: [
      { type: "1", name: "SPX Standard", cod: true, codAllowed: true },
      { type: "3", name: "SPX Hemat", cod: true, codAllowed: true },
    ] },
    // JNE reports cod=true but the platform disallows it (codAllowed:false) — the SPX-only policy.
    { courier: "jne", enabled: true, services: [{ type: "REG", name: "Reguler", cod: true, codAllowed: false }] },
    // A disabled courier row must grant nothing even if its service looks COD-allowed.
    { courier: "sicepat", enabled: false, services: [{ type: "REG", cod: true, codAllowed: true }] },
    // An instant courier is out of scope entirely, cod flag notwithstanding.
    { courier: "gosend", enabled: true, services: [{ type: "instant", cod: true, codAllowed: true }] },
    // A legacy plain-string service carries no cod info → no COD.
    { courier: "jnt", enabled: true, services: ["EZ"] as unknown[] },
  ],
};
const mk = (o: Partial<CodPolicyInput> = {}) => buildCodPolicy({ ...base, ...o });
const okReq = { courier: "spx", serviceType: "1", total: 250_000, province: "DI Yogyakarta" };

describe("COD gate — the happy path and the two global switches", () => {
  it("all five agree → allowed (reason null)", () => {
    const p = mk();
    expect(p.enabled).toBe(true);
    expect(p.allows("spx", "1")).toBe(true);
    expect(p.reason(okReq)).toBeNull();
  });

  it("platform OFF → nothing is COD, whatever the request", () => {
    const p = mk({ platformCod: { ...base.platformCod!, enabled: false } });
    expect(p.enabled).toBe(false);
    expect(p.allows("spx", "1")).toBe(false);
    expect(p.reason(okReq)).toMatch(/tidak tersedia/i);
  });

  it("store OFF → this merchant refuses COD", () => {
    const p = mk({ storeCodEnabled: false });
    expect(p.enabled).toBe(false);
    expect(p.reason(okReq)).toMatch(/tidak menerima COD/i);
  });
});

describe("COD gate — condition 3: the cap (a risk limit that must actually bound)", () => {
  it("over the cap → rejected with the cap in the message", () => {
    expect(mk().reason({ ...okReq, total: 2_000_001 })).toMatch(/COD hanya untuk pesanan sampai/i);
  });
  it("exactly at the cap → allowed", () => {
    expect(mk().reason({ ...okReq, total: 2_000_000 })).toBeNull();
  });
  it("a missing or negative total cannot be checked → rejected, never assumed OK", () => {
    expect(mk().reason({ ...okReq, total: null })).toMatch(/tidak dapat diverifikasi/i);
    expect(mk().reason({ ...okReq, total: -1 })).toMatch(/tidak dapat diverifikasi/i);
  });
  it("cap = 0 means no cap → a huge order passes the cap check", () => {
    const p = mk({ platformCod: { ...base.platformCod!, maxAmountIdr: 0 } });
    expect(p.reason({ ...okReq, total: 999_000_000 })).toBeNull();
  });
});

describe("COD gate — condition 4: the province allow-list (free-text, normalised)", () => {
  it("a province not on the list → rejected", () => {
    expect(mk().reason({ ...okReq, province: "Papua" })).toMatch(/belum tersedia untuk provinsi/i);
  });
  it("empty province while a list exists → asks for it (does not silently allow)", () => {
    expect(mk().reason({ ...okReq, province: "" })).toMatch(/Isi provinsi tujuan/i);
  });
  it("an empty allow-list means COD anywhere", () => {
    const p = mk({ platformCod: { ...base.platformCod!, allowedProvinces: [] } });
    expect(p.reason({ ...okReq, province: "Papua" })).toBeNull();
  });
  it("matches despite honorifics/spelling: 'Daerah Istimewa Yogyakarta' and 'prov. jawa barat'", () => {
    expect(mk().reason({ ...okReq, province: "Daerah Istimewa Yogyakarta" })).toBeNull();
    expect(mk().reason({ ...okReq, province: "prov. jawa barat" })).toBeNull();
  });
});

describe("COD gate — condition 5: only a genuinely COD-allowed service carries it", () => {
  it("SPX (codAllowed:true) is allowed; JNE (codAllowed:false, even though cod:true) is not", () => {
    const p = mk();
    expect(p.allows("spx", "3")).toBe(true);
    expect(p.allows("jne", "REG")).toBe(false);
    expect(p.reason({ ...okReq, courier: "jne", serviceType: "REG" })).toMatch(/tidak mendukung COD/i);
  });
  it("a disabled courier grants nothing; an instant courier is out of scope; a legacy string service has no COD", () => {
    const p = mk();
    expect(p.allows("sicepat", "REG")).toBe(false); // courier disabled
    expect(p.allows("gosend", "instant")).toBe(false); // instant, excluded
    expect(p.allows("jnt", "EZ")).toBe(false); // legacy plain string
  });
  it("no courier/service picked → COD needs a supporting service", () => {
    expect(mk().reason({ ...okReq, courier: null, serviceType: null })).toMatch(/memerlukan layanan/i);
  });
  it("courier/service matching is case- and whitespace-insensitive", () => {
    expect(mk().allows(" SPX ", "1")).toBe(true);
  });
});

describe("normProvince", () => {
  it("collapses honorifics and punctuation to a bare key", () => {
    expect(normProvince("DI Yogyakarta")).toBe(normProvince("Daerah Istimewa Yogyakarta"));
    expect(normProvince("prov. Jawa Barat")).toBe("jawabarat");
    expect(normProvince("DKI Jakarta")).toBe("jakarta");
  });
});
