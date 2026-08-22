import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { scryptSync, timingSafeEqual } from "node:crypto";
import { db, schema } from "@tokophi/db";
import { eq } from "drizzle-orm";
import { authSecretBytes } from "@tokophi/lib/secret";

// The super-admin's OWN auth — platform operators (us), separate from store `users`.
// Uses a DISTINCT cookie (`platform_session`) from the admin's `session` cookie: on localhost
// cookies are host-scoped (shared across :3000/:3001), and impersonation mints the admin
// `session` cookie — so the two must not collide.
// Lazy (throws in prod if AUTH_SECRET is unset, never at build) — see @tokophi/lib/secret.
const secret = () => authSecretBytes();
export const PLATFORM_COOKIE = "platform_session";
// Matches the JWT expiry set in `signPlatformSession`. It was a bare `60 * 60 * 24 * 7` written out
// at both call sites — the admin's `SESSION_MAX_AGE` is the same constant, named, one app over.
export const PLATFORM_MAX_AGE = 60 * 60 * 24 * 7; // 7d

// The session SHAPE and the rule that decides what a cookie is still worth both live in
// `platform-session.ts` — pure, so they can be tested without a database. Re-exported here so every
// existing `import { … } from "@/lib/platform-auth"` keeps working.
export type { PlatformSession } from "./platform-session";
import { resolvePlatformSession, type PlatformSession } from "./platform-session";

export function verifyPassword(pw: string, stored: string | null): boolean {
  if (!stored) return false;
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(pw, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function findAdmin(email: string) {
  const [row] = await db
    .select({
      id: schema.platformAdmins.id,
      email: schema.platformAdmins.email,
      name: schema.platformAdmins.name,
      role: schema.platformAdmins.role,
      passwordHash: schema.platformAdmins.passwordHash,
    })
    .from(schema.platformAdmins)
    .where(eq(schema.platformAdmins.email, email.toLowerCase().trim()))
    .limit(1);
  return row ?? null;
}

/**
 * `issuedAt` overrides the token's `iat`. Exactly one caller passes it —
 * `changePlatformPassword`, which has just rotated the credential and must hand the operator's own
 * tab a replacement that is unambiguously NEWER than the rotation it caused (the same-second
 * tie-break in `sessionOutlivesPassword` resolves to REVOKED on purpose). Everyone else mints at
 * `now()`. Mirrors `signSession` in `apps/admin/lib/auth.ts`.
 */
export async function signPlatformSession(s: PlatformSession, issuedAt?: Date): Promise<string> {
  return new SignJWT({ ...s })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(issuedAt ? Math.floor(issuedAt.getTime() / 1000) : undefined)
    .setExpirationTime("7d")
    .sign(secret());
}

/**
 * The operator's session, RE-READ against `platform_admins` on every request.
 *
 * ⚠️ It used to return the JWT payload verbatim — decode, cast, done. `role` is what
 * `requirePlatformAdmin` gates all 27 mutating actions on, so for the token's full seven days the
 * rank was whatever was true at login and nothing ever looked again. Measured, holding one cookie
 * constant while mutating the row by SQL: an operator demoted owner → support **still minted a new
 * platform operator** (an owner-gated act), and so did one whose row had been **deleted outright**.
 * The merchant side had re-read `store_users` since day one; the control plane — which reaches EVERY
 * tenant — was the weaker of the two.
 *
 * ONE indexed primary-key lookup per call buys all of it back, and the honest cost is small: this
 * runs once in the platform layout and once inside `requirePlatformAdmin`, i.e. one or two reads per
 * request. The merchant's `getSession()` is called far more often than that (every
 * `withCurrentTenant` read goes through it) and is likewise uncached, so there is no per-request
 * cache pattern in this repo to reuse and nothing here earns inventing one.
 *
 * The decision itself is in `resolvePlatformSession` — pure, and tested.
 */
export async function getPlatformSession(): Promise<PlatformSession | null> {
  const token = (await cookies()).get(PLATFORM_COOKIE)?.value;
  if (!token) return null;
  let claims: PlatformSession;
  let iat: number | undefined;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    claims = payload as unknown as PlatformSession;
    iat = payload.iat;
  } catch {
    return null;
  }
  if (!claims?.adminId) return null;
  try {
    const [row] = await db
      .select({ role: schema.platformAdmins.role, passwordChangedAt: schema.platformAdmins.passwordChangedAt })
      .from(schema.platformAdmins)
      .where(eq(schema.platformAdmins.id, claims.adminId))
      .limit(1);
    return resolvePlatformSession(claims, iat, row ?? null);
  } catch (err) {
    // A database blip (or an `adminId` Postgres refuses to cast) must not hand back a stale rank on
    // the surface that reaches every tenant. Fail closed — the operator re-authenticates.
    console.error("[platform-auth] operator re-check failed", err);
    return null;
  }
}

/**
 * Platform roles, from least to most powerful. `platform_admins.role` already stores this; nothing
 * was ever reading it.
 *
 *   support — reads, works the ticket queue. Cannot touch money, credentials, or a merchant's shop.
 *   admin   — the day-to-day operator: payouts, store lifecycle, platform settings.
 *   owner   — everything, including impersonating a merchant and resetting their password.
 */
// The ladder itself lives in `platform-rank.ts` — a pure module with no DB import, so the rule that
// guards every super-admin mutation can actually be tested.
export type { PlatformRole } from "./platform-rank";
import { clearsRank, type PlatformRole } from "./platform-rank";
// The route floors are pure data in their own module, for the same reason the ladder is: this file
// pulls @tokophi/db at module scope, so anything living in it cannot be tested.
import { landingForRole, minRoleForPath, reasonForPath } from "./route-roles";

/** The refusal shape every super-admin action already speaks: `{ ok: false, error }`. */
export type PlatformRefusal = { ok: false; error: string };
export type PlatformGate = { ok: true; admin: PlatformSession } | PlatformRefusal;

/**
 * Security boundary for every super-admin mutation — the NON-THROWING half.
 *
 * 🔴 WHY THIS EXISTS. `requirePlatformAdmin` throws, and a `"use server"` action that throws does
 * not reach its caller's `{ ok, error }` handling at all: the rejection lands in the
 * `startTransition` nobody catches. Driven 2026-08-05 against a real server, one operator cookie
 * held constant while the row was demoted owner → support by SQL, then "Simpan" pressed on
 * Pengaturan → Pembayaran:
 *
 *   | build | what the operator saw |
 *   |---|---|
 *   | `next dev`   | ZERO toasts, and the dev error overlay over the whole screen |
 *   | `next start` | ZERO toasts, and the page REPLACED by Next's own global error — *"This page couldn't load · A server error occurred · ERROR 2389982270"*, in English, on a Bahasa Indonesia control plane |
 *
 * So the refused operator is not merely told nothing — the screen they were working on is gone, and
 * nothing on it says the word "izin". They reload and try again, because that is what the page
 * tells them to do.
 *
 * ⚠️ `requirePlatformAdmin` STAYS, and it stays throwing. A gate whose refusal can be ignored by
 * forgetting an `if` is a gate that fails OPEN, and 27 actions rest on this one comparison. The two
 * share ONE decision and ONE message (a copy is how the weaker half survives a fix — the same
 * reason `platform-rank.ts` and `session-revocation` are single implementations); an action opts
 * into the returnable shape deliberately, and `tsc` then forces it to handle the refusal because
 * `gate.admin` does not exist on the other arm of the union.
 */
export async function platformGate(min: PlatformRole = "admin"): Promise<PlatformGate> {
  const s = await getPlatformSession();
  if (!s) return { ok: false, error: "Sesi berakhir atau akun tidak aktif lagi. Masuk lagi lalu ulangi." };
  if (!clearsRank(s.role, min)) return { ok: false, error: rankRefusal(min, s.role) };
  return { ok: true, admin: s };
}

/**
 * The ONE sentence a rank refusal is spoken in — shared by the action gate above and the route gate
 * below. Two copies would drift, and the operator would be told two different things about one
 * rule; that is the same reason `platform-rank.ts` and `session-revocation` are single
 * implementations.
 */
export const rankRefusal = (min: PlatformRole, role: string | undefined): string =>
  `Tidak diizinkan — perlu peran ${min}, akun ini ${role || "tanpa peran"}.`;

/**
 * ROUTE ENTRY — the additive half of SEC-9 (Task 5.17).
 *
 * Called as the FIRST await of every protected page, ABOVE its data reads, because the defect being
 * closed is that the privileged data was already fetched and rendered before anything looked at a
 * rank. `platformGate` stays exactly where it is inside each action: this does not replace it, and
 * a mutation must never rely on it (a server-action POST does not re-enter the page).
 *
 * ⚠️ NO SESSION HERE MEANS THE OPERATOR ROW IS GONE OR THEIR PASSWORD WAS ROTATED — the middleware
 * already turned away anyone without a valid JWT, on the edge, where it cannot ask the database. So
 * this redirects to the sign-out ROUTE, never straight to `/login`: middleware sees the still-valid
 * cookie and bounces `/login` back to `/`, and the two ping-pong (`ERR_TOO_MANY_REDIRECTS`, measured
 * on this repo before). Only a route handler can delete a cookie. Same rule, same target, as the
 * platform layout.
 *
 * COST: one indexed primary-key lookup, on top of the layout's. There is no `react` `cache()`
 * pattern in this repo and this does not earn inventing one — see the note on `getPlatformSession`.
 */
export type PlatformRouteGate =
  | { ok: true; admin: PlatformSession }
  | { ok: false; need: PlatformRole; role: string; reason: string; error: string; landing: string };

export async function platformRouteGate(path: string): Promise<PlatformRouteGate> {
  const s = await getPlatformSession();
  if (!s) redirect("/api/auth/signout");
  const need = minRoleForPath(path);
  if (!clearsRank(s.role, need)) {
    return {
      ok: false,
      need,
      role: s.role,
      reason: reasonForPath(path),
      error: rankRefusal(need, s.role),
      landing: landingForRole(s.role),
    };
  }
  return { ok: true, admin: s };
}

/**
 * Security boundary for every super-admin mutation — the THROWING half.
 *
 * ⚠️ It used to check only that SOMEONE was logged in — the `role` on the session was carried
 * around and never once read. So a `support` operator could reject a merchant's withdrawal, reset
 * any merchant's password, and impersonate them into their own shop. The role column existed, the
 * session carried it, and the gate ignored it: the most dangerous kind of security control, the one
 * that looks present.
 *
 * Callers now state the minimum role they need. Default `admin` — a mutation is not a read, so
 * "logged in" is not the bar.
 */
export async function requirePlatformAdmin(min: PlatformRole = "admin"): Promise<PlatformSession> {
  const gate = await platformGate(min);
  if (!gate.ok) throw new Error(gate.error);
  return gate.admin;
}
