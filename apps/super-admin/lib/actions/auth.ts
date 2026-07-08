"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PLATFORM_COOKIE, findAdmin, verifyPassword, signPlatformSession } from "@/lib/platform-auth";

export type SignInState = { error?: string };

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const row = await findAdmin(email);
  if (!row || !verifyPassword(password, row.passwordHash)) {
    return { error: "Email atau kata sandi salah." };
  }
  const token = await signPlatformSession({
    adminId: row.id,
    email: row.email,
    name: row.name ?? "",
    role: row.role,
  });
  (await cookies()).set(PLATFORM_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  redirect("/");
}

export async function signOut(): Promise<void> {
  (await cookies()).delete(PLATFORM_COOKIE);
  redirect("/login");
}
