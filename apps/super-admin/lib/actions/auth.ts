"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { PLATFORM_COOKIE, findAdmin, verifyPassword, signPlatformSession } from "@/lib/platform-auth";
import { rateLimit } from "@tokophi/lib/cache";

export type SignInState = { error?: string };

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  // Brute-force guard on the CONTROL PLANE login — cap attempts per client IP before the (scrypt)
  // password check. In-process (does not survive a restart or span replicas — the known limitation
  // tracked in BACKLOG), but far better than the previous NONE. This is the operator login, so keep it
  // a touch tighter than the merchant panel: 10/min.
  const h = await headers();
  const ip = h.get("cf-connecting-ip") || h.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!rateLimit(`login:platform:${ip}`, 10, 60_000).ok) {
    return { error: "Terlalu banyak percobaan masuk. Coba lagi dalam 1 menit." };
  }

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
