/**
 * The control-plane rank ladder, deliberately in its OWN module.
 *
 * `platform-auth.ts` imports `@tokophi/db` at module scope, so anything that imports IT drags a live
 * database connection in — which is why the rule that guards every super-admin mutation had no test.
 * The ladder is pure data; keeping it here makes it testable without a DB and costs nothing.
 *
 * support 1 < admin 2 < owner 3. `requirePlatformAdmin(min)` compares `RANK[role] >= RANK[min]`, and
 * an unknown role falls to 0 — fail closed, so a typo'd or legacy value in `platform_admins.role`
 * cannot inherit rank.
 */
export type PlatformRole = "support" | "admin" | "owner";

export const RANK: Record<string, number> = { support: 1, admin: 2, owner: 3 };

/** Does `role` clear an action gated at `min`? The one comparison the whole control plane rests on. */
export const clearsRank = (role: string | undefined, min: PlatformRole = "admin"): boolean =>
  (RANK[role ?? ""] ?? 0) >= (RANK[min] ?? RANK.admin);
