import "server-only";
import { emailError } from "./validate";

// Simple in-process TTL cache. Cuts repeated live calls (e.g. KiriminAja pricing) + latency.
// PROD SWAP: replace this module with Cloudflare Workers KV (edge) or Redis — same get/set/cached
// interface — since in-memory doesn't persist across serverless/edge invocations.
type Entry = { value: unknown; expires: number };
const store = new Map<string, Entry>();

export function cacheGet<T>(key: string): T | null {
  const e = store.get(key);
  if (!e) return null;
  if (Date.now() > e.expires) {
    store.delete(key);
    return null;
  }
  return e.value as T;
}

export function cacheSet(key: string, value: unknown, ttlMs: number): void {
  store.set(key, { value, expires: Date.now() + ttlMs });
  // opportunistic cleanup so the Map doesn't grow unbounded in a long-lived process
  if (store.size > 5000) {
    const now = Date.now();
    for (const [k, v] of store) if (now > v.expires) store.delete(k);
  }
}

// get-or-compute: return the cached value, else run fn() and cache it.
export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cacheGet<T>(key);
  if (hit !== null) return hit;
  const val = await fn();
  cacheSet(key, val, ttlMs);
  return val;
}

// Fixed-window rate limit. Returns {ok:false} once `limit` hits are reached within `windowMs`.
// PROD SWAP: Cloudflare Rate Limiting (edge) / Workers KV / Upstash — same intent.
const hits = new Map<string, { count: number; reset: number }>();
export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; remaining: number; retryAfterMs: number } {
  const now = Date.now();
  const e = hits.get(key);
  if (!e || now > e.reset) {
    hits.set(key, { count: 1, reset: now + windowMs });
    if (hits.size > 10000) for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
    return { ok: true, remaining: limit - 1, retryAfterMs: 0 };
  }
  e.count++;
  if (e.count > limit) return { ok: false, remaining: 0, retryAfterMs: e.reset - now };
  return { ok: true, remaining: limit - e.count, retryAfterMs: 0 };
}

// ── Failed sign-ins, counted PER ACCOUNT ──────────────────────────────────────────────────────────
//
// `rateLimit` above counts an IP. That bounds how FAST one source may guess — it is the only brake we
// have and it stays the brake — but it answers a different question, and the difference is the whole
// point of this block: it can throttle an attack for weeks without anyone ever learning that one
// particular merchant is the target. Measured 2026-08-06, `grep -rn
// "failed_login|loginFailed|login_attempts"` over the whole repo returned NOTHING: a failed sign-in
// was written to no table, no log and no screen, so a slow distributed grind against a named account
// was invisible on every surface we own.
//
// ⚠️ THE SAME IN-PROCESS LIMITATION AS `rateLimit`, WRITTEN DOWN RATHER THAN HIDDEN. This `Map` is
// per process: it resets on every redeploy and does not span replicas. So a count in an audit row is
// a FLOOR, never a measurement — the real burst can be larger, and one spread thin enough across
// replicas may never reach the threshold at all. This is not a detector; it is a witness that
// produces evidence when it happens to see enough of one. PROD SWAP is the same one the two caches
// above name (Redis / Workers KV / a `login_attempts` table), and only that swap makes the number
// true.
//
// ── WHY FIVE, AND WHY A 15-MINUTE *IDLE* WINDOW ──
// Somebody mistyping their own password two or three times is ORDINARY, and an audit row for it is
// worse than none: a log that fires on normal behaviour is a log that stops being read, which this
// repo has already paid for twice (`verify-rls` sat red for weeks and two cross-tenant leaks shipped
// past it). Five IN A ROW on one address is past any typo pattern, and it sits well under the IP
// ceilings above (15/min seller, 10/min platform) so a real burst still trips it inside the first
// minute. The streak is broken by a SUCCESS or by 15 minutes of quiet — not by a fixed boundary,
// because a one-per-minute grinder is exactly the shape a fixed window forgets, and it is the same
// shape that already walks under the IP limiter.
//
// ── WHY IT ESCALATES ×5 INSTEAD OF FIRING EVERY 5 ──
// One row per five failures is up to three rows a minute PER SOURCE ADDRESS at the seller ceiling,
// and a flood is how a signal stops being read — the failure this whole change exists to fix, one
// layer over. Rows are emitted at 5, 25, 125, 625, … so a ten-thousand-attempt night leaves SIX rows,
// each stating a real count, and the operator reads the size off one row instead of counting rows.
const FAILED_LOGIN_ALERT_AT = 5;
const FAILED_LOGIN_ESCALATION = 5;
const FAILED_LOGIN_IDLE_MS = 15 * 60_000;
const failures = new Map<string, { count: number; nextReport: number; idleUntil: number }>();

export type LoginSurface = "seller" | "platform";
const SURFACE_LABEL: Record<LoginSurface, string> = { seller: "Dashboard Seller", platform: "Super Admin" };

const failedLoginKey = (surface: LoginSurface, email: string) => `${surface}:${email.trim().toLowerCase()}`;

// 🔴 THE ONE THING THIS ROW MAY NEVER CONTAIN IS THE CREDENTIAL, so the address is not echoed
// verbatim either. The likeliest way a real password reaches `platform_activity` is not a bug in the
// insert — it is a person typing it one field too high and pressing Enter. Anything that is not a
// well-formed address is therefore summarised rather than repeated. The shape rule is the repo's own
// (`emailError`), with the empty string excluded: at checkout an email is optional and blank is
// valid, on a login form blank is just a failure with no subject.
function loginSubject(email: string): string {
  const s = email.trim().toLowerCase();
  return s.length > 0 && emailError(s) === null ? s : "alamat yang bukan email (tidak dicatat)";
}

/**
 * Count one failed sign-in for `email`. Returns the AUDIT TEXT when this failure lands on a reporting
 * threshold (5, 25, 125, …), else `null` — so the caller writes at most one `platform_activity` row
 * per burst and never one per attempt.
 *
 * 🔴 Its only parameters are the surface and the address. There is no argument a password could
 * travel in, and that is deliberate: the rule is easier to keep when the signature enforces it.
 */
export function recordFailedLogin(surface: LoginSurface, email: string): string | null {
  const now = Date.now();
  const key = failedLoginKey(surface, email);
  const prev = failures.get(key);
  const e = prev && now <= prev.idleUntil ? prev : { count: 0, nextReport: FAILED_LOGIN_ALERT_AT, idleUntil: 0 };
  e.count++;
  e.idleUntil = now + FAILED_LOGIN_IDLE_MS;
  failures.set(key, e);
  if (failures.size > 10000) for (const [k, v] of failures) if (now > v.idleUntil) failures.delete(k);
  if (e.count < e.nextReport) return null;
  e.nextReport *= FAILED_LOGIN_ESCALATION;
  return `${e.count} percobaan masuk gagal berturut-turut untuk ${loginSubject(email)} di ${SURFACE_LABEL[surface]}`;
}

/** A sign-in that succeeded ends the streak — "berturut-turut" has to mean it. */
export function clearFailedLogins(surface: LoginSurface, email: string): void {
  failures.delete(failedLoginKey(surface, email));
}

// ── N62, SECOND HALF: THE ACCOUNT-KEYED BRAKE THE IP LIMITER CANNOT BE ──
// `rateLimit` counts a SOURCE; a distributed grind brings its own sources, so one named account
// could be tried at 15/min × as many addresses as the attacker holds, forever, with only audit rows
// to show for it. This lock is keyed on the ACCOUNT: once a streak reaches 25 consecutive failures,
// sign-in attempts for that address are refused before the password is even checked.
//
// · WHY 25 — it is the SECOND escalation rung (5 → 25), so by the time an account locks, TWO audit
//   rows already name the attack: no lock ever happens silently. And no human's own typo pattern
//   reaches 25 in a row with not one success in between.
// · A REFUSED ATTEMPT MUST NOT FEED THE STREAK. The caller checks THIS before calling
//   `recordFailedLogin`, so a locked attempt does not extend `idleUntil` — otherwise the attacker's
//   own hammering holds the victim's lock open forever. As written, the lock self-expires 15 minutes
//   (`FAILED_LOGIN_IDLE_MS`) after the last COUNTED failure.
// · THE TRADE IS NAMED, NOT HIDDEN: an attacker who can reach the form can lock a victim out for up
//   to 15 minutes per 25-failure burst. That is the classic lockout-DOS cost of any account brake;
//   with the alternative — an unbounded distributed grind — it is the cheaper harm, and the 60-bit
//   mint (`password.ts`) is what makes the remaining throughput (~25 tries / 15 min) worthless.
// · Same in-process `Map` limitation as everything in this file: per replica, gone on redeploy.
//   A floor, not a wall; the wall is entropy.
const FAILED_LOGIN_LOCK_AT = 25;

/** Is sign-in for this address currently refused? Check BEFORE `recordFailedLogin` — see above. */
export function failedLoginLocked(surface: LoginSurface, email: string): boolean {
  const e = failures.get(failedLoginKey(surface, email));
  return e !== undefined && Date.now() <= e.idleUntil && e.count >= FAILED_LOGIN_LOCK_AT;
}
