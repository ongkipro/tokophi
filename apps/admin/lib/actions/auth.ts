"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, findLogin, verifyPassword, signSession } from "@/lib/auth";

export type SignInState = { error?: string };

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const row = await findLogin(email);
  if (!row || !verifyPassword(password, row.passwordHash)) {
    return { error: "Email atau kata sandi salah." };
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
