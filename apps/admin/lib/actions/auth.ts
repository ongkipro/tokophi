"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, findLogin, verifyPassword, signSession } from "@/lib/auth";
import { verifyTotp } from "@tokophi/lib/totp";

export type SignInState = { error?: string; need2fa?: boolean };

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const code = String(formData.get("code") ?? "").trim();
  const row = await findLogin(email);
  if (!row || !verifyPassword(password, row.passwordHash)) {
    return { error: "Email atau kata sandi salah." };
  }
  // second factor: if enabled, require a valid TOTP before issuing the session
  if (row.totpEnabled && row.totpSecret) {
    if (!code) return { need2fa: true };
    if (!verifyTotp(row.totpSecret, code)) return { need2fa: true, error: "Kode 2FA salah." };
  }
  const token = await signSession({
    userId: row.userId,
    storeId: row.storeId,
    role: row.role,
    email: row.email,
    name: row.name ?? "",
  });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  redirect(row.slug ? `/store/${row.slug}` : "/");
}

export async function signOut(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
