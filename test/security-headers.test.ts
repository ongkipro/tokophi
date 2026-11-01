import { describe, expect, it } from "vitest";
import { textWithoutComments, REPO_ROOT } from "./source-code";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// 2026-11 review item 5: a live `curl -I` on all four surfaces showed only HSTS. These headers are
// set in app code (Cloudflare sets none of them), so the guard reads the code. They are string
// VALUES, hence textWithoutComments (a comment that merely mentions DENY must not satisfy it).
const text = (rel: string) => textWithoutComments(readFileSync(join(REPO_ROOT, rel), "utf8"));

// The lexer re-spaces tokens (`"X" , value : "Y"`), so every gap is \s*.
const pair = (name: string, value: string) => new RegExp(`${name}["']\\s*,\\s*(?:value\\s*:\\s*)?["']${value}`);
const COMMON = [pair("X-Content-Type-Options", "nosniff"), pair("Referrer-Policy", "strict-origin-when-cross-origin"), /Permissions-Policy/];
const FRAME = [pair("X-Frame-Options", "DENY"), /frame-ancestors 'none'/];

const missing = (src: string, rules: RegExp[]) => rules.filter((r) => !r.test(src)).map(String);

describe("security headers", () => {
  for (const f of ["apps/admin/next.config.ts", "apps/super-admin/next.config.ts"]) {
    it(`${f} denies framing and sets the common set`, () => {
      expect(missing(text(f), [...FRAME, ...COMMON])).toEqual([]);
    });
    it(`${f} sends the report-only CSP (and only report-only: enforcing is a later, measured step)`, () => {
      const src = text(f);
      expect(src).toMatch(/CSP_REPORT_ONLY_HEADER/);
      expect(src).not.toMatch(/["']Content-Security-Policy["']\s*,\s*(value\s*:\s*)?ADMIN_CSP/);
    });
  }
  it("admin's blanket headers EXCLUDE /api/uploads/ — the route's own SVG sandbox CSP must survive", () => {
    const src = text("apps/admin/next.config.ts");
    expect(src).toMatch(/\(\?!api\/uploads\/\)/);
    // and no catch-all rule may carry SECURITY_HEADERS (that is what overwrote the sandbox)
    expect(/source\s*:\s*"\/:path\*"\s*,\s*headers\s*:[^}]*SECURITY_HEADERS/.test(src)).toBe(false);
  });
  it("storefront middleware sets the common set and does NOT deny framing (Store Builder preview)", () => {
    const src = text("apps/storefront/src/middleware.ts");
    expect(missing(src, COMMON)).toEqual([]);
    expect(/X-Frame-Options|frame-ancestors/.test(src)).toBe(false);
  });
  it("the matcher is RED against mutated copies (proof the guard can fail)", () => {
    const good = text("apps/admin/next.config.ts");
    expect(missing(good.replace("DENY", "SAMEORIGIN"), FRAME).length).toBeGreaterThan(0);
    expect(missing(good.replace("nosniff", ""), COMMON).length).toBeGreaterThan(0);
  });
});
