import { describe, expect, it } from "vitest";
import { devSignInAllowed, devSubject } from "./dev-signin";
import { readAccountSession, signAccountSession } from "./session";
import { waLink } from "@tokophi/lib/format";
import { areaTerm } from "../data/addresses";
import { complaintLink, complaintPeriodFor, isOnItsWay, returnLineFor, returnRequestMessage } from "./order-view";

const KEY = new TextEncoder().encode("k".repeat(40));
const SID = "3f1e2d4c-5b6a-4789-8abc-def012345678";

describe("dev sign-in gate", () => {
  it("is refused in a production build, by either signal", () => {
    expect(devSignInAllowed({ NODE_ENV: "production" }, false)).toBe(false);
    expect(devSignInAllowed({ NODE_ENV: "development" }, true)).toBe(false);
    expect(devSignInAllowed({ NODE_ENV: "development" }, false)).toBe(true);
  });
  it("only mints dev:<email> subjects", () => {
    expect(devSubject(" Rina@Demo.Local ")).toBe("dev:rina@demo.local");
    for (const bad of ["", "rina", "a@b", 42, null, "x y@z.id"]) expect(devSubject(bad)).toBeNull();
  });
});

describe("account session cookie", () => {
  it("round-trips the session id", async () => {
    expect(await readAccountSession(await signAccountSession(SID, KEY), KEY)).toBe(SID);
  });
  it("refuses another key, a tampered token, garbage and nothing", async () => {
    const t = await signAccountSession(SID, KEY);
    expect(await readAccountSession(t, new TextEncoder().encode("z".repeat(40)))).toBeNull();
    expect(await readAccountSession(t.slice(0, -2) + (t.endsWith("A") ? "BB" : "AA"), KEY)).toBeNull();
    expect(await readAccountSession("nope", KEY)).toBeNull();
    expect(await readAccountSession(undefined, KEY)).toBeNull();
  });
});

describe("areaTerm — the kecamatan search drops a typed Kota/Kabupaten prefix", () => {
  it("strips the prefix the reference table keeps in its own column", () => {
    expect(areaTerm("Kota Yogyakarta")).toBe("Yogyakarta");
    expect(areaTerm("  kab. Bantul ")).toBe("Bantul");
    expect(areaTerm("Kabupaten Sleman")).toBe("Sleman");
    expect(areaTerm("Kecamatan Sewon")).toBe("Sewon");
    expect(areaTerm("Kotabaru")).toBe("Kotabaru");
  });
});

describe("return / complaint hand-off message", () => {
  it("names the store and the order, prompts the proof, and promises nothing for the store", () => {
    const m = returnRequestMessage("Batik Nusantara", "PHI-713020233OA7");
    expect(m).toContain("Batik Nusantara");
    expect(m).toContain("PHI-713020233OA7");
    expect(m).toMatch(/foto\/video/i);
    expect(m).not.toMatch(/pasti|wajib|dijamin|hukum|undang-undang/i);
  });
  it("opens the store's WhatsApp chat with the message encoded", () => {
    const url = waLink("081234567890", returnRequestMessage("Toko A", "PHI-1"));
    expect(url).toMatch(/^https:\/\/wa\.me\/6281234567890\?text=/);
    expect(decodeURIComponent(url.split("text=")[1]!)).toContain("pesanan PHI-1");
  });
});

describe("what an order page shows about returns, by status (ACC-16, RR-10)", () => {
  const base = { storeWhatsapp: "081234567890", storeName: "Toko A", number: "PHI-1", returnWindowDays: 7 as number | null };
  it("only orders on their way or delivered can start a return or complaint", () => {
    for (const status of ["dikirim", "selesai"]) expect(isOnItsWay(status)).toBe(true);
    for (const status of ["baru", "diproses", "batal", "retur", ""]) expect(isOnItsWay(status)).toBe(false);
  });
  it("the complaint link needs a status that qualifies AND a WhatsApp number — never the declared window", () => {
    const noWindow = { ...base, status: "selesai", returnWindowDays: null }; // the store declared no window
    expect(complaintLink(noWindow)).toMatch(/^https:\/\/wa\.me\//); // …and the hand-off is still offered
    expect(complaintLink({ ...base, status: "dikirim" })).toMatch(/^https:\/\/wa\.me\//);
    expect(complaintLink({ ...base, status: "diproses" })).toBeNull();
    expect(complaintLink({ ...base, status: "batal" })).toBeNull();
    expect(complaintLink({ ...base, status: "selesai", storeWhatsapp: null })).toBeNull();
  });
  it("the window sentence appears only when declared and only once goods are on their way", () => {
    expect(returnLineFor({ status: "selesai", returnWindowDays: 7 })).toBe("Toko ini menerima pengajuan retur selama 7 hari kerja setelah barang diterima.");
    expect(returnLineFor({ status: "dikirim", returnWindowDays: 14 })).toContain("14 hari");
    expect(returnLineFor({ status: "selesai", returnWindowDays: null })).toBeNull();
    expect(returnLineFor({ status: "diproses", returnWindowDays: 7 })).toBeNull();
  });
});

describe("the store's complaint-resolution period on an order page (ACC-17)", () => {
  it("shows the store's own figure once goods are on their way, and nothing when undeclared", () => {
    expect(complaintPeriodFor({ status: "selesai", complaintResolutionDays: 3 })).toBe("Jangka waktu penyelesaian komplain yang ditetapkan toko: 3 hari kerja.");
    expect(complaintPeriodFor({ status: "dikirim", complaintResolutionDays: 5 })).toContain("5 hari kerja");
    expect(complaintPeriodFor({ status: "selesai", complaintResolutionDays: null })).toBeNull();
    expect(complaintPeriodFor({ status: "diproses", complaintResolutionDays: 3 })).toBeNull();
    expect(complaintPeriodFor({ status: "baru", complaintResolutionDays: 3 })).toBeNull();
  });
});
