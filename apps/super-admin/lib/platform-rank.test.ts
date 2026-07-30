import { describe, expect, it } from "vitest";
import { RANK, clearsRank, type PlatformRole } from "./platform-rank";

// The control plane reaches EVERY tenant, so its rank ladder is the only thing standing between a
// support operator and a merchant's account. These are the two facts the code depends on and that
// nothing else would fail on if they changed.
//
// Written after `resetStoreUserPassword` was found running at the DEFAULT `admin` rank while looking
// its target up by `userId` ALONE — no `store_users` join, no `storeId` filter — so a rank-2 operator
// could reset ANY user row on the platform, including any store's owner, routing straight around the
// `requirePlatformAdmin("owner")` on `resetOwnerPassword` two functions above it.

const ROLES: PlatformRole[] = ["support", "admin", "owner"];

describe("platform rank ladder", () => {
  it("is strictly ordered support < admin < owner", () => {
    expect(RANK.support).toBeLessThan(RANK.admin);
    expect(RANK.admin).toBeLessThan(RANK.owner);
  });

  it("only `owner` clears an owner-gated action", () => {
    // `requirePlatformAdmin(min)` compares `RANK[role] >= RANK[min]`. Owner-gated actions are the
    // account-handover ones: impersonate, invitePlatformAdmin, resetOwnerPassword, and now an
    // owner-targeted resetStoreUserPassword.
    const clears = clearsRank;
    for (const r of ROLES) {
      expect(clears(r, "owner"), `${r} vs owner-gated`).toBe(r === "owner");
    }
    // …and an admin-gated action is cleared by admin and owner, but never by support.
    expect(clears("support", "admin")).toBe(false);
    expect(clears("admin", "admin")).toBe(true);
    expect(clears("owner", "admin")).toBe(true);
  });

  it("an unknown role clears nothing", () => {
    // `RANK[s.role] ?? 0` — a role string that is not in the ladder must fail closed, not default to
    // admin. A typo'd or legacy value in `platform_admins.role` would otherwise inherit rank.
    expect(RANK["staff"] ?? 0).toBe(0);
    expect(clearsRank("staff")).toBe(false);
    expect(clearsRank(undefined)).toBe(false);
  });
});
