"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, SESSION_MAX_AGE, hashPassword, signSession } from "@/lib/auth";
import { emailTaken, provisionStore } from "@/lib/provision";

export type RegisterState = { error?: string };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Self-serve signup: nama toko + nama pemilik + email + kata sandi → one-txn tenant bootstrap
// (account/store/owner/membership/trial), then sign the SAME session JWT as the login flow.
export async function registerStore(_prev: RegisterState, formData: FormData): Promise<RegisterState> {
  const storeName = String(formData.get("storeName") ?? "").trim();
  const ownerName = String(formData.get("ownerName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!storeName || !ownerName || !email || !password) return { error: "Semua kolom wajib diisi." };
  if (storeName.length < 3) return { error: "Nama toko minimal 3 karakter." };
  if (!EMAIL_RE.test(email)) return { error: "Format email tidak valid." };
  if (password.length < 8) return { error: "Kata sandi minimal 8 karakter." };
  if (await emailTaken(email)) return { error: "Email sudah terdaftar. Silakan masuk." };

  const r = await provisionStore({
    storeName,
    ownerName,
    email,
    passwordHash: hashPassword(password),
    authProvider: "password",
  });

  const token = await signSession({ userId: r.userId, storeId: r.storeId, role: r.role, email: r.email, name: r.name });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  redirect(`/store/${r.slug}`);
}
