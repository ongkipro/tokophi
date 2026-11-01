import { describe, expect, it } from "vitest";
import { ADMIN_CSP_REPORT_ONLY, MAX_REPORT_BYTES, STOREFRONT_CSP_REPORT_ONLY, summariseCspReport } from "./csp";

describe("CSP policies", () => {
  it("admin: first-party only, no framing, no object, reports to its own origin", () => {
    expect(ADMIN_CSP_REPORT_ONLY).toContain("default-src 'self'");
    expect(ADMIN_CSP_REPORT_ONLY).toContain("frame-ancestors 'none'");
    expect(ADMIN_CSP_REPORT_ONLY).toContain("object-src 'none'");
    expect(ADMIN_CSP_REPORT_ONLY).toContain("report-uri /api/csp-report");
    expect(ADMIN_CSP_REPORT_ONLY).not.toMatch(/facebook|tiktok|google/);
  });
  it("storefront: lists the three ad platforms and does NOT forbid framing (Store Builder preview)", () => {
    expect(STOREFRONT_CSP_REPORT_ONLY).toContain("https://connect.facebook.net");
    expect(STOREFRONT_CSP_REPORT_ONLY).toContain("https://analytics.tiktok.com");
    expect(STOREFRONT_CSP_REPORT_ONLY).toContain("https://www.googletagmanager.com");
    expect(STOREFRONT_CSP_REPORT_ONLY).toContain("https://*.tiktokw.us"); // measured, not guessed
    expect(STOREFRONT_CSP_REPORT_ONLY).not.toContain("frame-ancestors");
    expect(STOREFRONT_CSP_REPORT_ONLY).toContain("report-uri /api/csp-report");
  });
  it("neither policy contains a wildcard script source or eval (that is what enforcing would add by mistake)", () => {
    for (const p of [ADMIN_CSP_REPORT_ONLY, STOREFRONT_CSP_REPORT_ONLY]) {
      expect(p).not.toContain("'unsafe-eval'");
      expect(p.split("; ").find((d) => d.startsWith("script-src"))).not.toMatch(/\s\*(\s|$)|https:(\s|$)/);
    }
  });
});

describe("summariseCspReport", () => {
  const legacy = (o: object) => JSON.stringify({ "csp-report": o });
  it("reads the report-uri shape and strips query + fragment (they can carry tokens)", () => {
    const l = summariseCspReport(
      legacy({
        "document-uri": "https://toko.tokophi.com/checkout?email=a@b.c&token=SECRET#x",
        "violated-directive": "script-src-elem",
        "effective-directive": "script-src-elem",
        "blocked-uri": "https://evil.example/p.js?k=SECRET",
        "source-file": "https://toko.tokophi.com/a.js?v=1",
        "line-number": 12,
      }),
    );
    expect(l).toBe("directive=script-src-elem blocked=https://evil.example/p.js doc=https://toko.tokophi.com/checkout src=https://toko.tokophi.com/a.js:12");
    expect(l).not.toMatch(/SECRET|a@b\.c|token=/);
  });
  it("reads the Reporting-API array shape", () => {
    expect(summariseCspReport(JSON.stringify([{ type: "csp-violation", body: { effectiveDirective: "img-src", blockedURL: "inline", documentURL: "https://x.test/p" } }]))).toBe(
      "directive=img-src blocked=inline doc=https://x.test/p",
    );
  });
  it("rejects anything that is not a CSP report, oversized, or not JSON", () => {
    expect(summariseCspReport("not json")).toBeNull();
    expect(summariseCspReport("{}")).toBeNull();
    expect(summariseCspReport(JSON.stringify({ "csp-report": {} }))).toBeNull();
    expect(summariseCspReport("x".repeat(MAX_REPORT_BYTES + 1))).toBeNull();
  });
  it("clips attacker-controlled lengths", () => {
    const l = summariseCspReport(legacy({ "effective-directive": "x".repeat(500), "blocked-uri": "y".repeat(500) }))!;
    expect(l.length).toBeLessThan(260);
  });
});
