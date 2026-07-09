"use server";
import { db, schema } from "@tokophi/db";
import { and, eq } from "drizzle-orm";
import { scryptSync, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { signImpersonation } from "./session";
import { requirePlatformAdmin } from "./platform-auth";
import { kaTestConnection } from "@tokophi/lib/kiriminaja";
import { alTestConnection, alProbeChannels } from "@tokophi/lib/autolaris";

// Every super-admin mutation is gated by `requirePlatformAdmin()` (the security boundary):
// impersonation + store lifecycle + provisioning + settings all require a platform-admin session.

const DEV_PASSWORD = "tokophi123"; // default local password for provisioned owners/admins
const ANCHOR = new Date("2026-07-02T00:00:00Z"); // matches the seed's TODAY so createdDaysAgo reads "0 hari lalu"

function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 64).toString("hex")}`;
}
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Impersonate a store's owner: mint the admin session cookie (host-scoped to localhost, so it
// reaches :3000) and hand back the admin URL for the client to open.
export async function impersonateStore(storeId: string): Promise<{ ok: boolean; adminUrl?: string; error?: string }> {
  await requirePlatformAdmin();
  const [owner] = await db
    .select({
      userId: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      storeId: schema.storeUsers.storeId,
      role: schema.storeUsers.role,
      slug: schema.stores.slug,
    })
    .from(schema.storeUsers)
    .innerJoin(schema.users, eq(schema.users.id, schema.storeUsers.userId))
    .innerJoin(schema.stores, eq(schema.stores.id, schema.storeUsers.storeId))
    .where(and(eq(schema.storeUsers.storeId, storeId), eq(schema.storeUsers.role, "owner")))
    .limit(1);

  if (!owner) return { ok: false, error: "Toko tidak punya pemilik (owner) untuk dibukakan panelnya." };

  // Short-lived token → admin's /impersonate exchanges it for a session cookie on the ADMIN
  // domain (cross-subdomain cookies aren't shared, so we can't set it from here).
  const token = await signImpersonation({
    userId: owner.userId,
    storeId: owner.storeId,
    role: owner.role,
    email: owner.email,
    name: owner.name ?? owner.email,
  });
  // read at runtime (module-scope reads get baked at build time when the env is unset)
  const adminBase = process.env.ADMIN_URL ?? "http://localhost:3000";
  const url = `${adminBase}/impersonate?token=${encodeURIComponent(token)}&slug=${encodeURIComponent(owner.slug)}`;
  return { ok: true, adminUrl: url };
}

export async function setStoreStatus(storeId: string, status: "active" | "trial" | "suspended"): Promise<void> {
  await requirePlatformAdmin();
  await db.update(schema.stores).set({ status }).where(eq(schema.stores.id, storeId));
  revalidatePath("/toko");
  revalidatePath(`/toko/${storeId}`);
  revalidatePath("/");
}

export async function setStorePlan(storeId: string, plan: "pemula" | "bisnis" | "skala"): Promise<void> {
  await requirePlatformAdmin();
  await db.update(schema.stores).set({ plan }).where(eq(schema.stores.id, storeId));
  // keep the account tier in sync (billing is per-account)
  const [s] = await db.select({ accountId: schema.stores.accountId }).from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
  if (s) await db.update(schema.accounts).set({ plan }).where(eq(schema.accounts.id, s.accountId));
  revalidatePath("/toko");
  revalidatePath(`/toko/${storeId}`);
  revalidatePath("/");
}

// ---- provisioning: onboard a new merchant store (account + owner + store + membership + stats) ----
export type NewStoreInput = { name: string; ownerName: string; email: string; city: string; plan: "pemula" | "bisnis" | "skala" };
export async function createStore(input: NewStoreInput): Promise<{ ok: boolean; storeId?: string; error?: string }> {
  await requirePlatformAdmin();
  const name = input.name?.trim();
  const email = input.email?.trim().toLowerCase();
  const ownerName = input.ownerName?.trim() || name;
  const city = input.city?.trim() || null;
  if (!name || !email) return { ok: false, error: "Nama toko & email pemilik wajib diisi." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "Format email tidak valid." };
  const slug = slugify(name);
  if (!slug) return { ok: false, error: "Nama toko tidak valid." };

  const [dupEmail] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (dupEmail) return { ok: false, error: "Email sudah dipakai pengguna lain." };
  const [dupSlug] = await db.select({ id: schema.stores.id }).from(schema.stores).where(eq(schema.stores.slug, slug)).limit(1);
  if (dupSlug) return { ok: false, error: `Nama toko bentrok (slug "${slug}" sudah ada).` };

  const storeId = await db.transaction(async (tx) => {
    const [acc] = await tx.insert(schema.accounts).values({ name, plan: input.plan, createdAt: ANCHOR }).returning();
    const [u] = await tx.insert(schema.users).values({ email, name: ownerName, passwordHash: hashPassword(DEV_PASSWORD) }).returning();
    const [st] = await tx.insert(schema.stores).values({ accountId: acc.id, name, slug, city, plan: input.plan, status: "trial", createdAt: ANCHOR }).returning();
    await tx.insert(schema.storeUsers).values({ storeId: st.id, userId: u.id, role: "owner", acceptedAt: ANCHOR });
    await tx.insert(schema.locations).values({ storeId: st.id, name: "Gudang Utama", isDefault: true });
    await tx.insert(schema.storeSettings).values({ storeId: st.id });
    await tx.insert(schema.storeStats).values({ storeId: st.id, gmvIdr: 0, ordersCount: 0, productsCount: 0, updatedAt: ANCHOR });
    return st.id;
  });
  revalidatePath("/toko");
  revalidatePath("/");
  return { ok: true, storeId };
}

// ---- billing: mark an invoice paid / failed / pending ----
export async function setInvoiceStatus(number: string, status: "dibayar" | "menunggu" | "gagal"): Promise<void> {
  await requirePlatformAdmin();
  await db.update(schema.invoices).set({ status }).where(eq(schema.invoices.number, number));
  revalidatePath("/paket");
  revalidatePath("/");
}

// ---- platform settings: persist gateway / courier toggles (were fake-saved before) ----
// Live-probe AutoLaris, persist `active` per channel, and auto-enable the active ones.
// EXPENSIVE (one create_payment per channel) — super-admin on-demand only.
export async function syncPaymentChannels(): Promise<void> {
  await requirePlatformAdmin();
  const probed = await alProbeChannels();
  for (const p of probed) {
    await db
      .update(schema.platformPaymentChannels)
      .set({ active: p.active, enabled: p.active })
      .where(eq(schema.platformPaymentChannels.channel, p.code));
  }
  revalidatePath("/pengaturan");
}

// Persist the enable/disable toggles (what's offered at checkout).
export async function savePaymentChannels(updates: { key: string; on: boolean }[]): Promise<void> {
  await requirePlatformAdmin();
  for (const u of updates) {
    await db
      .update(schema.platformPaymentChannels)
      .set({ enabled: u.on })
      .where(eq(schema.platformPaymentChannels.channel, u.key));
  }
  revalidatePath("/pengaturan");
}

export async function saveGateways(updates: { key: string; on: boolean }[]): Promise<void> {
  await requirePlatformAdmin();
  for (const u of updates) {
    if (u.key === "cod") await db.update(schema.platformCod).set({ enabled: u.on });
    else await db.update(schema.platformPaymentGateways).set({ enabled: u.on }).where(eq(schema.platformPaymentGateways.provider, u.key as "midtrans" | "xendit" | "duitku"));
  }
  revalidatePath("/pengaturan");
}

export async function saveCouriers(updates: { key: string; on: boolean }[]): Promise<void> {
  await requirePlatformAdmin();
  for (const u of updates) await db.update(schema.platformCouriers).set({ enabled: u.on }).where(eq(schema.platformCouriers.courier, u.key));
  revalidatePath("/pengaturan");
}

// ---- KiriminAja aggregator: live connectivity test (platform key) ----
export async function testKiriminajaConnection(): Promise<{ ok: boolean; env: string; provinces?: number; message: string }> {
  await requirePlatformAdmin();
  return kaTestConnection();
}

// ---- AutoLaris payment gateway: live connectivity test ----
export async function testAutolarisConnection(): Promise<{ ok: boolean; message: string }> {
  await requirePlatformAdmin();
  return alTestConnection();
}

// ---- platform team: invite another operator (real platform_admins row) ----
export async function invitePlatformAdmin(input: { name: string; email: string; role: string }): Promise<{ ok: boolean; error?: string }> {
  await requirePlatformAdmin();
  const email = input.email?.trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "Email tidak valid." };
  const [dup] = await db.select({ id: schema.platformAdmins.id }).from(schema.platformAdmins).where(eq(schema.platformAdmins.email, email)).limit(1);
  if (dup) return { ok: false, error: "Email sudah terdaftar sebagai operator." };
  await db.insert(schema.platformAdmins).values({ email, name: input.name?.trim() || null, role: input.role || "admin", passwordHash: hashPassword(DEV_PASSWORD) });
  revalidatePath("/pengaturan");
  return { ok: true };
}
