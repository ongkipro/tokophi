import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { codeOnly } from "../../../test/source-code";
import { classifyKaProbe } from "./ka-probe";

// Task 8.3 — the KiriminAja health tile. The vendor is never called here: `classifyKaProbe` is pure
// and the four cases below are the four shapes `kaTestConnection` can return (plus the timeout
// stand-in `getKiriminajaProbe` races against it, which is the `unreachable` shape).

const ALLOWLIST_401 = "Your IP address 45.77.33.112 were not allowed to access this API";

describe("classifyKaProbe", () => {
  it("ok — the vendor answered with a province list", () => {
    const v = classifyKaProbe({ ok: true, env: "sandbox", configured: true, httpStatus: 200, provinces: 34, message: "Terhubung" });
    expect(v.state).toBe("ok");
    expect(v.word).toBe("Terhubung");
    expect(v.detail).toBe("34 provinsi");
  });

  it("refused — a parseable {status:false} keeps the vendor's sentence VERBATIM (the 2026-09-07 shape)", () => {
    const v = classifyKaProbe({ ok: false, env: "sandbox", configured: true, httpStatus: 401, text: ALLOWLIST_401, message: "…" });
    expect(v.state).toBe("refused");
    expect(v.word).toBe("Ditolak");
    expect(v.detail).toBe(`HTTP 401: ${ALLOWLIST_401}`);
    expect(v.detail).not.toMatch(/Tidak terhubung/);
  });

  it("unreachable — no JSON came back (timeout, HTML 502, network)", () => {
    const v = classifyKaProbe({ ok: false, env: "sandbox", configured: true, httpStatus: 502, message: "KiriminAja /api/mitra/province → HTTP 502, non-JSON body: <html>" });
    expect(v.state).toBe("unreachable");
    expect(v.word).toBe("Tidak terjangkau");
    expect(v.detail).toMatch(/HTTP 502/);
    // and the timeout stand-in from `getKiriminajaProbe`, which carries no status at all
    expect(classifyKaProbe({ ok: false, env: "sandbox", configured: true, message: "Tidak ada jawaban" }).state).toBe("unreachable");
  });

  it("unconfigured — no key, nothing was called", () => {
    const v = classifyKaProbe({ ok: false, env: "sandbox", configured: false, message: "API key belum diisi" });
    expect(v.state).toBe("unconfigured");
    expect(v.word).toBe("Belum dikonfigurasi");
  });
});

// ── The source claim: `SystemStatus.kiriminaja` is a PROBE, not key presence ─────────────────────
// A claim about what `getSystemStatus` derives the field from, so it reads the file's CODE (see
// `test/source-code.ts`); the predicate is proved to fire on a copy with the old line put back, so
// the guard cannot be green for want of matching anything.
const DATA = readFileSync(new URL("./data.ts", import.meta.url), "utf8");
const KEY_PRESENCE = /kiriminaja\s*:\s*kiriminajaConfigured\s*\(\s*\)/;

describe("SystemStatus.kiriminaja is derived from the live probe", () => {
  it("is no longer `kiriminajaConfigured()`", () => {
    const code = codeOnly(DATA);
    expect(code).not.toMatch(KEY_PRESENCE);
    expect(code).toMatch(/kiriminaja\s*:\s*kiriminajaProbe\s*\.\s*state\s*===\s*"ok"/);
    // and the probe is what `getSystemStatus` awaits
    expect(code).toMatch(/function\s+getSystemStatus[\s\S]*?getKiriminajaProbe\s*\(\s*\)/);
  });

  it("mutation self-check: the predicate fires on the old line", () => {
    const mutated = DATA.replace(/kiriminaja\s*:\s*kiriminajaProbe\.state === "ok",/, "kiriminaja: kiriminajaConfigured(),");
    expect(mutated).not.toBe(DATA);
    expect(codeOnly(mutated)).toMatch(KEY_PRESENCE);
  });
});
