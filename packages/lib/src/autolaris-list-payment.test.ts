import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { codeOnly } from "../../../test/source-code";
import { compareChannelFees, mergeChannelProbe, parseListPayment, type AlChannelProbe } from "./autolaris";

// The exact envelope `GET /api/h2h/list_payment` returned from the production admin container on
// 2026-09-09 (key never left the container; only the response body was read back). It matches the
// vendor's own OpenAPI snapshot: each row is `channel_code` + `name` + `admin` + `tipe_admin`, and
// there is NO active/enabled field — absence from `data` is the only "not available" signal.
const LIVE = {
  rc: "00",
  ket: "Sukses",
  data: [
    { channel_code: "COD", name: "COD", admin: "0.0", tipe_admin: "fix" },
    { channel_code: "QRIS", name: "QRIS", admin: "0.7", tipe_admin: "persen" },
    { channel_code: "VABNI", name: "Bank BNI", admin: "3000.0", tipe_admin: "fix" },
    { channel_code: "VAPERMATA", name: "Bank Permata", admin: "3000.0", tipe_admin: "fix" },
    { channel_code: "VABCA", name: "Bank BCA", admin: "6500.0", tipe_admin: "fix" },
    { channel_code: "VAMANDIRI", name: "Bank Mandiri", admin: "3000.0", tipe_admin: "fix" },
    { channel_code: "VABRI", name: "Bank BRI", admin: "3000.0", tipe_admin: "fix" },
    { channel_code: "OVO", name: "OVO", admin: "3.0", tipe_admin: "persen" },
  ],
};

describe("parseListPayment — envelope", () => {
  const cases: { name: string; json: unknown; ok: boolean; error?: RegExp }[] = [
    { name: "live production response", json: LIVE, ok: true },
    { name: "rc is not 00 → data is never consumed", json: { rc: "07", ket: "Channel tidak aktif", data: [{ channel_code: "QRIS" }] }, ok: false, error: /Channel tidak aktif/ },
    { name: "rc failure with no ket still names the rc", json: { rc: "99", data: [] }, ok: false, error: /rc=99/ },
    { name: "data is not an array", json: { rc: "00", ket: "Sukses", data: { channel_code: "QRIS" } }, ok: false },
    { name: "null body", json: null, ok: false },
    { name: "empty but well-formed list", json: { rc: "00", ket: "Sukses", data: [] }, ok: true },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const r = parseListPayment(c.json);
      expect(r.ok).toBe(c.ok);
      if (!c.ok) expect(r.channels).toEqual([]);
      if (c.error) expect(r.error).toMatch(c.error);
    });
  }

  it("rc=07 must not leak the row it shipped alongside the failure", () => {
    // The one shape that would be silently wrong: consuming `data` before checking `rc` would
    // report a channel the account does not have as available.
    expect(parseListPayment({ rc: "07", data: [{ channel_code: "QRIS", name: "QRIS", admin: "0.7", tipe_admin: "persen" }] }).channels).toHaveLength(0);
  });
});

describe("parseListPayment — per-row fee normalisation", () => {
  const row = (over: Record<string, unknown>) => parseListPayment({ rc: "00", data: [{ channel_code: "X", name: "X", admin: "1", tipe_admin: "fix", ...over }] }).channels[0];

  const table: { name: string; over: Record<string, unknown>; feeType: string; feeValue: number | null }[] = [
    { name: "fix → flat IDR", over: { admin: "3000.0", tipe_admin: "fix" }, feeType: "flat", feeValue: 3000 },
    { name: "persen → FRACTION, not a percentage", over: { admin: "0.7", tipe_admin: "persen" }, feeType: "pct", feeValue: 0.007 },
    { name: "persen 3.0 → 0.03", over: { admin: "3.0", tipe_admin: "persen" }, feeType: "pct", feeValue: 0.03 },
    { name: "a genuine zero fee is kept as 0, not dropped", over: { admin: "0.0", tipe_admin: "fix" }, feeType: "flat", feeValue: 0 },
    { name: "unknown tipe_admin → unknown, never guessed", over: { admin: "3000", tipe_admin: "nominal" }, feeType: "unknown", feeValue: null },
    { name: "missing tipe_admin → unknown", over: { tipe_admin: undefined }, feeType: "unknown", feeValue: null },
    { name: "missing admin → unknown, NOT zero", over: { admin: undefined }, feeType: "unknown", feeValue: null },
    { name: "non-numeric admin → unknown", over: { admin: "gratis" }, feeType: "unknown", feeValue: null },
    { name: "numeric admin sent as a JSON number still parses", over: { admin: 6500, tipe_admin: "fix" }, feeType: "flat", feeValue: 6500 },
    { name: "TIPE_ADMIN is case/space tolerant", over: { admin: "0.7", tipe_admin: " Persen " }, feeType: "pct", feeValue: 0.007 },
  ];
  for (const t of table) {
    it(t.name, () => {
      const r = row(t.over);
      expect(r.feeType).toBe(t.feeType);
      expect(r.feeValue).toBe(t.feeValue);
    });
  }

  it("a row with no channel_code is dropped — it identifies nothing", () => {
    const r = parseListPayment({ rc: "00", data: [{ name: "Mystery", admin: "1", tipe_admin: "fix" }, "nonsense", null, { channel_code: "QRIS", name: "QRIS", admin: "0.7", tipe_admin: "persen" }] });
    expect(r.channels.map((c) => c.code)).toEqual(["QRIS"]);
  });

  it("channel_code is normalised to upper case and the raw provider values are preserved", () => {
    const r = row({ channel_code: " vabca ", admin: "6500.0", tipe_admin: "fix" });
    expect(r.code).toBe("VABCA");
    expect(r.rawAdmin).toBe("6500.0");
    expect(r.rawTipeAdmin).toBe("fix");
  });

  it("falls back to the channel code when the provider sends no name", () => {
    expect(row({ channel_code: "VABCA", name: "" }).providerName).toBe("VABCA");
  });
});

describe("mergeChannelProbe — availability is presence in the response", () => {
  it("everything the provider listed is active; everything only we know about is not", () => {
    const m = mergeChannelProbe(parseListPayment(LIVE));
    expect(m.ok).toBe(true);
    const by = new Map(m.channels.map((c) => [c.code, c]));
    // enabled: listed by the provider
    for (const code of ["QRIS", "VABCA", "VABNI", "VABRI", "VAMANDIRI", "VAPERMATA", "OVO", "COD"]) {
      expect(by.get(code)?.active, code).toBe(true);
    }
    // disabled: in our display table but NOT in the response (there is no per-row status field)
    for (const code of ["VABSI", "VACIMB", "VADANAMON", "DANA", "SHOPEEPAY", "LINKAJA", "GOPAY", "ALFAMART", "INDOMARET"]) {
      expect(by.get(code)?.active, code).toBe(false);
      expect(by.get(code)?.fee, code).toBeNull();
    }
  });

  it("a code we have no label for still surfaces, under the provider's name", () => {
    // A hardcoded roster must never be able to hide a channel the account really has.
    const m = mergeChannelProbe(parseListPayment(LIVE));
    const cod = m.channels.find((c) => c.code === "COD");
    expect(cod).toMatchObject({ active: true, label: "COD", kind: "" });
  });

  it("our own labels win over the provider's for a code we know", () => {
    const m = mergeChannelProbe(parseListPayment(LIVE));
    expect(m.channels.find((c) => c.code === "VABCA")).toMatchObject({ label: "Virtual Account BCA", kind: "va" });
  });

  it("a failed read yields NO channels — never 'everything is inactive'", () => {
    // Writing an empty result to the DB would deactivate every channel and take checkout's payment
    // options offline; the caller must be able to tell failure from an empty account.
    const m = mergeChannelProbe(parseListPayment({ rc: "01", ket: "Invalid parameter" }));
    expect(m).toEqual({ ok: false, error: "Invalid parameter", channels: [] });
  });
});

describe("compareChannelFees — reports divergence, changes nothing", () => {
  const rows = compareChannelFees(mergeChannelProbe(parseListPayment(LIVE)).channels);
  const by = new Map(rows.map((r) => [r.code, r]));

  it("only ACTIVE channels are compared", () => {
    expect(rows.map((r) => r.code).sort()).toEqual(["COD", "OVO", "QRIS", "VABCA", "VABNI", "VABRI", "VAMANDIRI", "VAPERMATA"]);
  });

  it("QRIS 0,7% matches our schedule", () => {
    expect(by.get("QRIS")).toMatchObject({ verdict: "match", ours: { type: "pct", value: 0.007 }, theirs: { type: "pct", value: 0.007 } });
  });

  it("VA BCA Rp6.500 matches — the per-channel override is honoured", () => {
    expect(by.get("VABCA")).toMatchObject({ verdict: "match", ours: { value: 6500 }, theirs: { value: 6500 } });
  });

  // This test used to assert the OPPOSITE — `verdict: "differs"`, ours 3500 against theirs 3000 —
  // and that is why the comparator exists: it found a Rp500 overcharge on the four cheapest channels
  // we offer, sitting there since the 2026-08-24 schedule. The owner lowered the VA default to
  // Rp3.000 on 2026-09-10 and the divergence closed. Same shape as the OVO case below, in the same
  // direction of travel: the schedule is a mirror of the provider's configuration, and every gap
  // between them is money moving to or from the buyer without anyone deciding it.
  it("the other VA banks no longer diverge: our default was lowered to Rp3.000 (2026-09-10)", () => {
    for (const code of ["VABNI", "VABRI", "VAMANDIRI", "VAPERMATA"]) {
      expect(by.get(code), code).toMatchObject({ verdict: "match", ours: { value: 3000 }, theirs: { value: 3000 } });
    }
  });

  it("OVO no longer diverges: our e-wallet rate was raised to 3% to match the provider (2026-09-09)", () => {
    expect(by.get("OVO")).toMatchObject({ verdict: "match", ours: { value: 0.03 }, theirs: { value: 0.03 } });
  });

  it("COD is NOT compared — its cost lives in order-finance, not the gateway schedule", () => {
    expect(by.get("COD")).toMatchObject({ verdict: "not-compared", ours: null });
  });

  it("a fee format we cannot read is 'not-compared', never silently 'match'", () => {
    const probe: AlChannelProbe[] = [{ code: "QRIS", label: "QRIS", kind: "qris", active: true, fee: { code: "QRIS", providerName: "QRIS", feeType: "unknown", feeValue: null, rawAdmin: "gratis", rawTipeAdmin: "" } }];
    expect(compareChannelFees(probe)[0]).toMatchObject({ verdict: "not-compared" });
  });

  it("a TYPE mismatch is a divergence, not a skip", () => {
    // We charge VA a flat rupiah amount; a provider switching that bank to a percentage scales with
    // basket size and must not read as agreement.
    const probe: AlChannelProbe[] = [{ code: "VABCA", label: "VA BCA", kind: "va", active: true, fee: { code: "VABCA", providerName: "Bank BCA", feeType: "pct", feeValue: 0.01, rawAdmin: "1.0", rawTipeAdmin: "persen" } }];
    expect(compareChannelFees(probe)[0].verdict).toBe("differs");
  });
});

// ── The guard that keeps the bill-creating probe from coming back ───────────────────────────────
//
// The old discovery loop fired ONE REAL `POST /api/h2h/create_payment` per channel — sixteen live
// provider calls per Sync, each CREATING AN ACTUAL BILL on the platform's AutoLaris account, every
// one abandoned. `tsc`, lint and the build were all green while it did that, and so was every test:
// nothing about creating a real transaction is a type error. Only reading the CODE catches it.
//
// `codeOnly` (never the raw text) because this file is full of comments that legitimately mention
// `create_payment` — including the one explaining why the loop was removed. A text match would go
// permanently red on the explanation, and a naive comment stripper would have its own holes.
const SRC = readFileSync(join(__dirname, "autolaris.ts"), "utf8");

/** The discovery path: everything from the list_payment parser down to the fee comparison. */
function probePath(src: string): string {
  const code = codeOnly(src);
  const from = code.indexOf("function parseListPayment");
  const to = code.indexOf("async function al <");
  // `al<T>` is the shared POST helper and is defined after the probe path; if either marker moves,
  // fail loudly rather than silently asserting over an empty string.
  expect(from, "parseListPayment marker").toBeGreaterThan(-1);
  expect(to, "al<T> marker").toBeGreaterThan(from);
  return code.slice(from, to);
}

describe("no create_payment survives inside the channel probe path", () => {
  it("the probe path calls list_payment and creates nothing", () => {
    const path = probePath(SRC);
    expect(path).toContain("/api/h2h/list_payment");
    expect(path).not.toContain("create_payment");
  });

  it("MUTATION SELF-CHECK: the same predicate fires when the old loop is put back", () => {
    // Proved RED against a copy, not against the product source — the assertion above is worthless
    // if it cannot fail. This is the loop that shipped, verbatim in shape.
    const restored = SRC.replace(
      "export async function alProbeChannels(): Promise<AlProbeResult> {",
      `export async function alProbeChannels(): Promise<AlProbeResult> {
  for (const c of AUTOLARIS_KNOWN_CHANNELS) {
    await al<{ rc: string }>("/api/h2h/create_payment", { reff_id: \`PROBE-\${c.code}\`, channel_code: c.code, amount: "15000" });
  }`,
    );
    expect(restored).not.toBe(SRC); // the anchor still exists, so the mutation really was applied
    expect(probePath(restored)).toContain("create_payment");
  });
});
