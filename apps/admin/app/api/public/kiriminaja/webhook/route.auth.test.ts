import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

/**
 * The KiriminAja webhook gate, and the line it writes when it refuses.
 *
 * WHY THIS SUITE EXISTS: the vendor's OpenAPI 3.1 document (6.2.0) declares `expressShipmentEvent`
 * with `security: null` — no authentication on the callback — while their prose says
 * `Authorization: Bearer {api_key}`. If the spec is right, every genuine shipment event is refused
 * here, and the ONLY place that can be discovered is this log line. It therefore has to say enough
 * to identify the caller and the shape of what it presented, and nothing that could reveal the key.
 *
 * The gate itself is unchanged and is pinned first: a rejection that is diagnosable is worth nothing
 * if the diagnosis came at the cost of letting someone in.
 */

const KEY = "ka-live-key-0123456789abcdef";

// The route imports `verifyKaHint`, which pulls the database in. Nothing under test here reaches a
// hint — the accepted request carries an empty `data` — so the module is stubbed rather than
// requiring Postgres for an auth suite.
vi.mock("@/lib/ka-tracking", () => ({
  verifyKaHint: vi.fn(async () => ({ known: false, changed: [] as string[] })),
}));

function post(headers: Record<string, string>, body: unknown = { method: "x", data: [] }) {
  return new NextRequest("https://app.tokophi.com/api/public/kiriminaja/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  process.env.KIRIMINAJA_API_KEY = KEY;
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The single warn line the route emitted, or "" if it emitted none. */
function warnLine(): string {
  const call = warn.mock.calls.at(-1);
  return call ? String(call[0]) : "";
}

describe("the gate is unchanged — fail closed", () => {
  it("accepts the configured bearer", async () => {
    const res = await POST(post({ authorization: `Bearer ${KEY}` }));
    expect(res.status).toBe(200);
    expect(warn).not.toHaveBeenCalled();
  });

  it("rejects a missing Authorization header with 401", async () => {
    const res = await POST(post({}));
    expect(res.status).toBe(401);
    expect(warnLine()).toContain("auth=absent");
    expect(warnLine()).toContain("scheme=none");
  });

  it("rejects a wrong scheme with 401, and says the scheme was not a bearer", async () => {
    const res = await POST(post({ authorization: `Basic ${KEY}` }));
    expect(res.status).toBe(401);
    expect(warnLine()).toContain("auth=present");
    expect(warnLine()).toContain("scheme=other");
  });

  it("rejects a wrong-length credential with 401 and reports the mismatch", async () => {
    const res = await POST(post({ authorization: "Bearer short" }));
    expect(res.status).toBe(401);
    expect(warnLine()).toContain("scheme=bearer");
    expect(warnLine()).toContain("credLen=5");
    expect(warnLine()).toContain("lenMatch=no");
  });

  it("rejects a same-length-but-wrong credential, and lenMatch says the length DID match", async () => {
    // The case that would otherwise look identical to a typo: right shape, wrong secret.
    const res = await POST(post({ authorization: `Bearer ${"z".repeat(KEY.length)}` }));
    expect(res.status).toBe(401);
    expect(warnLine()).toContain(`credLen=${KEY.length}`);
    expect(warnLine()).toContain("lenMatch=yes");
  });

  it("rejects everything when no key is configured, and says so", async () => {
    delete process.env.KIRIMINAJA_API_KEY;
    const res = await POST(post({ authorization: `Bearer ${KEY}` }));
    expect(res.status).toBe(401);
    expect(warnLine()).toContain("lenMatch=nokey");
  });
});

describe("the rejection line is diagnosable", () => {
  it("keeps the prefix and the original phrase so existing greps still match", async () => {
    await POST(post({}));
    expect(warnLine()).toMatch(/^\[ka-webhook\] unauthorized webhook call rejected /);
    expect(warn).toHaveBeenCalledTimes(1); // ONE line, not a paragraph
  });

  it("carries every shape field and the caller IP", async () => {
    await POST(post({ authorization: "Bearer nope", "x-forwarded-for": "203.0.113.9, 10.0.0.1" }));
    const line = warnLine();
    for (const field of ["auth=", "scheme=", "credLen=", "lenMatch=", "ip=", "hdrs="]) {
      expect(line).toContain(field);
    }
    expect(line).toContain("ip=203.0.113.9");
  });

  it("names vendor-ish headers — by NAME, never by value", async () => {
    await POST(
      post({
        "x-callback-token": "the-vendors-actual-secret",
        "x-ka-signature": "deadbeefcafe",
        signature: "sig-value-here",
        "x-forwarded-for": "198.51.100.7",
      }),
    );
    const line = warnLine();
    expect(line).toContain("x-callback-token");
    expect(line).toContain("x-ka-signature");
    expect(line).toContain("signature");
    // The whole point: the names appear, the values never do.
    expect(line).not.toContain("the-vendors-actual-secret");
    expect(line).not.toContain("deadbeefcafe");
    expect(line).not.toContain("sig-value-here");
    // Proxy noise is filtered out so the interesting name is not buried.
    expect(line).not.toContain("x-forwarded-for");
  });

  it("never leaks the key, the presented credential, or a prefix of either", async () => {
    // Deliberately shares no leading substring with any FIELD NAME on the line: "presented-…"
    // starts with "presen", which collides with the literal `auth=present` and would make this
    // assertion fail on a correct implementation.
    const presented = "zq7-credential-material";
    await POST(post({ authorization: `Bearer ${presented}`, "x-callback-token": KEY }));
    const line = warnLine();
    expect(line).not.toContain(KEY);
    expect(line).not.toContain(presented);
    // A PREFIX is a free head start on a secret, so no substring of either may appear. 6 chars is
    // shorter than anything a truncating implementation would print.
    expect(line).not.toContain(KEY.slice(0, 6));
    expect(line).not.toContain(presented.slice(0, 6));
  });

  it("reports the scheme as a CLASS, so a bare credential is not echoed as its first word", async () => {
    // `Authorization: <secret>` with no scheme. An implementation that prints "the scheme token"
    // would print the entire secret here.
    await POST(post({ authorization: KEY }));
    const line = warnLine();
    expect(line).toContain("scheme=other");
    expect(line).not.toContain(KEY);
    expect(line).not.toContain(KEY.slice(0, 6));
  });
});
