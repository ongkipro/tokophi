import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { codeOnly } from "../../../test/source-code";
import { expiryStamp } from "./autolaris";

// AutoLaris reads `expired` as WIB — proven live 2026-09-01 (rc=08 for a UTC-built "now+1h" stamp,
// accepted once shifted +7h). The stamp must therefore be WIB BY ARITHMETIC, never the container's
// local clock: every deployed container runs UTC, which silently shortened a 24h bill to 17h, and a
// clock west of UTC would emit past stamps and fail every payment.
describe("expiryStamp is pinned to WIB, independent of the host clock", () => {
  it("matches Asia/Jakarta wall time for the same instant", () => {
    const now = Date.now();
    const got = expiryStamp(0);
    const wib = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Jakarta",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).format(new Date(now)).replace(/[^0-9]/g, "");
    // Two clock reads a moment apart can differ by one second — compare to the minute, then check
    // the seconds field is sane rather than equal.
    expect(got.slice(0, 12)).toBe(wib.slice(0, 12));
    expect(Number(got.slice(12))).toBeLessThan(60);
  });

  it("the source never reads the local clock (getHours and friends stay banned)", () => {
    const src = codeOnly(readFileSync(join(__dirname, "autolaris.ts"), "utf8"));
    // getUTC* is fine; bare local getters are the bug this file already shipped once.
    expect(/\.\s*get(Hours|Minutes|Seconds|Date|Month|FullYear)\s*\(/.test(src)).toBe(false);
  });
});
