import { describe, expect, it } from "vitest";
import { resolvePlatformSession } from "./platform-session";
import { clearsRank } from "./platform-rank";

// The control plane reaches EVERY tenant, and its session was the weaker of the two in this repo:
// `getPlatformSession()` decoded the 7-day JWT and returned the claims verbatim, while the merchant
// side had re-read `store_users` on every request since day one. Measured against a running server
// on 2026-08-03, one operator cookie held constant, mutations applied by SQL:
//
//   role owner → support    → still minted a NEW platform operator (an owner-gated act)
//   password_hash rewritten → same
//   the row DELETED         → same
//
// These are those three findings as assertions. They live here, and not inside `platform-auth.ts`,
// because that module imports `@tokophi/db` at import scope — the same reason `platform-rank.ts` was
// split out, and the same reason the rank gate itself went untested for months.

const CLAIMS = { adminId: "a-1", email: "op@tokophi.id", name: "Op", role: "owner" };
const NOW_SEC = Math.floor(Date.parse("2026-08-03T10:00:00Z") / 1000);
const row = (over: Partial<{ role: string; passwordChangedAt: Date | null }> = {}) => ({
  role: "owner",
  passwordChangedAt: null,
  ...over,
});

describe("resolvePlatformSession", () => {
  it("takes RANK from the row, never from the token — THE DEFECT", () => {
    // The cookie still says `owner`; the operator was demoted to `support` an hour ago. If the token
    // wins, `requirePlatformAdmin("owner")` lets them mint another operator for the next seven days.
    const s = resolvePlatformSession(CLAIMS, NOW_SEC, row({ role: "support" }));
    expect(s?.role).toBe("support");
    expect(clearsRank(s?.role, "owner"), "a demoted operator must not clear an owner gate").toBe(false);
  });

  it("ends the session the moment the operator row is gone", () => {
    // Deleting the row IS the lockout. It has to take effect on the next request, not in six days.
    expect(resolvePlatformSession(CLAIMS, NOW_SEC, null)).toBeNull();
    expect(resolvePlatformSession(CLAIMS, NOW_SEC, undefined)).toBeNull();
  });

  it("refuses a cookie older than the last password rotation", () => {
    // The incident this branch exists for: the operator password was exposed in a chat transcript.
    // Rotating it has to evict whoever already logged in with it, or the rotation is theatre.
    const rotated = new Date((NOW_SEC + 60) * 1000);
    expect(resolvePlatformSession(CLAIMS, NOW_SEC, row({ passwordChangedAt: rotated }))).toBeNull();
    // …and a token minted AFTER the rotation still works, or changing your password locks you out.
    expect(resolvePlatformSession(CLAIMS, NOW_SEC + 120, row({ passwordChangedAt: rotated }))?.role).toBe("owner");
  });

  it("lets every session that predates migration 0088 stand", () => {
    // If this flips, the deploy that adds the column signs out every operator holding a cookie.
    expect(resolvePlatformSession(CLAIMS, NOW_SEC, row())?.adminId).toBe("a-1");
    expect(resolvePlatformSession(CLAIMS, undefined, row())?.adminId).toBe("a-1");
  });

  it("fails closed on a token that names no operator", () => {
    // Nothing to re-read against. A session we cannot re-check is not a session.
    expect(resolvePlatformSession({ email: "x@y.z", role: "owner" }, NOW_SEC, row())).toBeNull();
    expect(resolvePlatformSession(null, NOW_SEC, row())).toBeNull();
  });

  it("an unknown role in the row inherits nothing", () => {
    // The row is the authority now, so a typo'd or legacy `platform_admins.role` must fail closed
    // exactly the way the ladder already promises — not fall back to whatever the token claimed.
    const s = resolvePlatformSession(CLAIMS, NOW_SEC, row({ role: "superuser" }));
    expect(s?.role).toBe("superuser");
    expect(clearsRank(s?.role)).toBe(false);
  });
});
