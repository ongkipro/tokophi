"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, SESSION_MAX_AGE, hashPassword, signSession } from "@/lib/auth";
import {
  EMAIL_TAKEN_MSG,
  ProvisionConflictError,
  ProvisionInputError,
  SignupClosedError,
  emailTaken,
  provisionStore,
  signupOpen,
} from "@/lib/provision";
import { rateLimit } from "@tokophi/lib/cache";
import { sessionCookieOptions } from "@tokophi/lib/session-cookie";

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

  // Steps ②/③ of the wizard. Optional by design: step ① alone creates the shop, so a merchant who
  // stops after it still has one. Read as strings and handed on untouched — `provisionStore`
  // normalises and bounds them at the boundary, because the Google path never sees this form.
  const opt = (k: string) => {
    const v = String(formData.get(k) ?? "").trim();
    return v || null;
  };
  const kecId = Number(formData.get("senderKecamatanId") ?? "");

  if (!storeName || !ownerName || !email || !password) return { error: "Semua kolom wajib diisi." };
  if (!EMAIL_RE.test(email)) return { error: "Format email tidak valid." };
  if (password.length < 8) return { error: "Kata sandi minimal 8 karakter." };
  // The name RULES now live in `provisionStore` so the Google path obeys them too; this is the
  // cheap pre-answer, and `emailTaken` stays here for the same reason — both save a scrypt hash and
  // a transaction. Neither is the boundary, and neither is the race guard: see the catch below.
  if (await emailTaken(email)) return { error: EMAIL_TAKEN_MSG };

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
      ownerPhone: opt("ownerPhone"),
      senderAddress: opt("senderAddress"),
      // A district id the browser sent — it is only ever a KiriminAja area id, and `provisionStore`
      // stores it verbatim because that is the currency `shipping-quote.ts` prices in. An id that
      // resolves to nothing produces no rates later and the seller fixes it in Pengaturan → Alamat;
      // it can never mis-price, because a quote is asked for by id, not by name.
      senderKecamatanId: Number.isFinite(kecId) && kecId > 0 ? kecId : null,
      senderKecamatanName: opt("senderKecamatanName"),
      senderKelurahanName: opt("senderKelurahanName"),
      senderPostcode: opt("senderPostcode"),
    });
  } catch (e) {
    if (e instanceof SignupClosedError) return { error: CLOSED_MSG };
    // A rule about the input, and a conflict Postgres decided — both are things this person can act
    // on, so both come back as a sentence on the form instead of as a Next error digest.
    if (e instanceof ProvisionInputError || e instanceof ProvisionConflictError) return { error: e.message };
    throw e;
  }

  const token = await signSession({ userId: r.userId, storeId: r.storeId, role: r.role, email: r.email, name: r.name });
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions(SESSION_MAX_AGE));
  redirect(`/store/${r.slug}`);
}
