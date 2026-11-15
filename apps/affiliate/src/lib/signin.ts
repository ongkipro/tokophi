// The sign-in and sign-up DOORS of affiliate.tokophi.com (ADR 0022) — the Seller login's brakes, reused,
// not re-invented (`apps/admin/lib/actions/auth.ts`):
//   · a per-IP cap before any scrypt runs (`login:` / `signup:` buckets — both FAIL CLOSED when the shared
//     Postgres counter is known-broken, `@tokophi/lib/rate-limit`);
//   · a per-ACCOUNT failure streak with its own surface ("affiliate"), checked BEFORE the password so a
//     refused attempt neither costs a hash nor extends the lock (`@tokophi/lib/cache`);
//   · one `platform_activity` row per BURST of failures (5, 25, 125 …), never the password.
import * as schema from "@tokophi/db/schema";
import { clearFailedLogins, failedLoginLocked, rateLimit, recordFailedLogin } from "@tokophi/lib/cache";
import { checkCredentials, createSession, signUp, type Db, type SignUpInput, type SignUpResult } from "../data/auth";

export const LOGIN_PER_IP_PER_MIN = 15;
export const SIGNUP_PER_IP_PER_10MIN = 5;

export type SignInOutcome = { ok: true; token: string } | { ok: false; error: string };

export async function signInWithPassword(
  db: Db,
  p: { ip: string; email: unknown; password: unknown; userAgent: string | null },
): Promise<SignInOutcome> {
  if (!rateLimit(`login:affiliate:${p.ip}`, LOGIN_PER_IP_PER_MIN, 60_000).ok) {
    return { ok: false, error: "Terlalu banyak percobaan masuk. Coba lagi dalam 1 menit." };
  }
  const email = typeof p.email === "string" ? p.email.trim().toLowerCase().slice(0, 254) : "";
  if (failedLoginLocked("affiliate", email)) {
    return { ok: false, error: "Terlalu banyak percobaan gagal. Coba lagi dalam 15 menit." };
  }
  const accountId = await checkCredentials(db, email, p.password);
  if (!accountId) {
    const text = recordFailedLogin("affiliate", email);
    if (text) {
      try {
        await db.insert(schema.platformActivity).values({ kind: "admin", text, storeId: null });
      } catch (e) {
        console.error("[affiliate] failed-login audit write failed", e);
      }
    }
    return { ok: false, error: "Email atau kata sandi salah." };
  }
  clearFailedLogins("affiliate", email);
  return { ok: true, token: await createSession(db, accountId, p.userAgent) };
}

export type SignUpOutcome = { ok: true; token: string } | (Extract<SignUpResult, { ok: false }> & { values: Record<string, string> });

export async function signUpAndSignIn(
  db: Db,
  p: { ip: string; input: SignUpInput; userAgent: string | null },
): Promise<SignUpOutcome> {
  const values = {
    name: typeof p.input.name === "string" ? p.input.name.slice(0, 120) : "",
    email: typeof p.input.email === "string" ? p.input.email.slice(0, 254) : "",
    phone: typeof p.input.phone === "string" ? p.input.phone.slice(0, 32) : "",
  };
  if (!rateLimit(`signup:affiliate:${p.ip}`, SIGNUP_PER_IP_PER_10MIN, 600_000).ok) {
    return { ok: false, errors: { form: "Terlalu banyak pendaftaran dari jaringan ini. Coba lagi nanti." }, values };
  }
  const r = await signUp(db, p.input);
  if (!r.ok) return { ...r, values };
  return { ok: true, token: await createSession(db, r.accountId, p.userAgent) };
}
