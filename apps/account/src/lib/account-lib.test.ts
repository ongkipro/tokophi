import { describe, expect, it } from "vitest";
import { devSignInAllowed, devSubject } from "./dev-signin";
import { readAccountSession, signAccountSession } from "./session";
import { areaTerm } from "../data/addresses";

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
