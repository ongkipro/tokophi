"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, SESSION_MAX_AGE, hashPassword, signSession } from "@/lib/auth";
import { emailTaken, provisionStore, signupOpen, SignupClosedError } from "@/lib/provision";
import { rateLimit } from "@tokophi/lib/cache";

export type RegisterState = { error?: string };

const CLOSED_MSG = "Pendaftaran toko baru sedang ditutup sementara. Hubungi kami jika kamu ingin bergabung.";
const TOO_MANY_MSG = "Terlalu banyak percobaan pendaftaran. Coba lagi dalam beberapa menit.";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Self-serve signup: nama toko + nama pemilik + email + kata sandi → one-txn tenant bootstrap
// (account/store/owner/membership/trial), then sign the SAME session JWT as the login flow.
export async function registerStore(_prev: RegisterState, formData: FormData): Promise<RegisterState> {
  // Checked here too (not only in provisionStore) so a closed signup answers immediately, without
  // hashing a password or hitting the DB. provisionStore stays the real boundary.
  if (!signupOpen()) return { error: CLOSED_MSG };

  // `signIn` beside this file has been rate-limited since `53dd9ee`; THIS door never was, and it is
  // the more expensive one — every call that gets past the checks writes SEVEN rows in one txn and
  // hands out a 3-day trial. Unmetered it is both a free-store faucet and, via the
  // "Email sudah terdaftar" answer below, an unbounded **email-enumeration oracle** against every
  // merchant on the platform. That answer is deliberate (a returning owner has to be told to log in
  // instead) — so the limit is what keeps it from being enumerable.
  //
  // Same known limits as every rate limit here (see CLAUDE.md): an in-process `Map`, so it resets on
  // redeploy and does not span replicas, and it counts IPs, not accounts. A floor, not a wall — the
  // wall is Cloudflare at the edge. 5 per 10 min is far below any human signing up once and still
  // leaves room for a NAT'd office onboarding a few shops in one sitting.
  const h = await headers();
  const ip = h.get("cf-connecting-ip") || h.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!rateLimit(`signup:admin:${ip}`, 5, 600_000).ok) return { error: TOO_MANY_MSG };

  const storeName = String(formData.get("storeName") ?? "").trim();
  const ownerName = String(formData.get("ownerName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!storeName || !ownerName || !email || !password) return { error: "Semua kolom wajib diisi." };
  if (storeName.length < 3) return { error: "Nama toko minimal 3 karakter." };
  if (!EMAIL_RE.test(email)) return { error: "Format email tidak valid." };
  if (password.length < 8) return { error: "Kata sandi minimal 8 karakter." };
  if (await emailTaken(email)) return { error: "Email sudah terdaftar. Silakan masuk." };

  // Only provisionStore is wrapped — `redirect()` below signals via a thrown error, so it must stay
  // outside any catch that could swallow it.
  let r: Awaited<ReturnType<typeof provisionStore>>;
  try {
    r = await provisionStore({
      storeName,
      ownerName,
      email,
      passwordHash: hashPassword(password),
      authProvider: "password",
    });
  } catch (e) {
    if (e instanceof SignupClosedError) return { error: CLOSED_MSG };
    throw e;
  }

  const token = await signSession({ userId: r.userId, storeId: r.storeId, role: r.role, email: r.email, name: r.name });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  redirect(`/store/${r.slug}`);
}
