"use server";
import { db, schema } from "@tokophi/db";
import { and, eq } from "drizzle-orm";
import { scryptSync, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { signImpersonation } from "./session";
import { requirePlatformAdmin } from "./platform-auth";
import { kaTestConnection } from "@tokophi/lib/kiriminaja";
import { alTestConnection, alProbeChannels, alCreatePayment } from "@tokophi/lib/autolaris";
import { addMonths, quote, withPpn } from "@tokophi/lib/billing";

// Audit helper — record an operator action against a specific store (shown on the store detail).
async function logStore(storeId: string, text: string): Promise<void> {
  await db.insert(schema.platformActivity).values({ kind: "admin", text, storeId });
}
const tempPassword = () => "tokophi-" + randomBytes(3).toString("hex"); // scrypt-hashed before storing

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
  const label = status === "suspended" ? "ditangguhkan" : status === "active" ? "diaktifkan" : "dikembalikan ke trial";
  await logStore(storeId, `Toko ${label} oleh platform`);
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
    // new store → 3-day free trial (real clock)
    const trialEndsAt = new Date(Date.now() + 3 * 86_400_000);
    const [st] = await tx.insert(schema.stores).values({ accountId: acc.id, name, slug, city, plan: input.plan, status: "trial", trialEndsAt, firstInvoicePaid: false, createdAt: ANCHOR }).returning();
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
  const existing = await db.select({ channel: schema.platformPaymentChannels.channel }).from(schema.platformPaymentChannels);
  const have = new Set(existing.map((e) => e.channel));
  for (const p of probed) {
    if (have.has(p.code)) {
      // reality → active; auto-enable active ones (platform can still toggle off after)
      await db
        .update(schema.platformPaymentChannels)
        .set({ active: p.active, enabled: p.active })
        .where(eq(schema.platformPaymentChannels.channel, p.code));
    } else {
      // roster channel not yet in the DB (e.g. added to AUTOLARIS_KNOWN_CHANNELS later) → insert it
      await db
        .insert(schema.platformPaymentChannels)
        .values({ channel: p.code, label: p.label, kind: p.kind, active: p.active, enabled: p.active });
    }
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

// ---- manual billing: create a VA invoice for a store + payment reminder ----
export async function createManualInvoice(storeId: string, cycle: "monthly" | "annual" = "monthly"): Promise<{ ok: boolean; number?: string; virtualAccount?: string; reused?: boolean; error?: string }> {
  await requirePlatformAdmin();
  // reuse an existing unpaid subscription invoice — never duplicate
  const [pending] = await db
    .select({ number: schema.invoices.number, virtualAccount: schema.invoices.virtualAccount })
    .from(schema.invoices)
    .where(and(eq(schema.invoices.storeId, storeId), eq(schema.invoices.kind, "subscription"), eq(schema.invoices.status, "menunggu")))
    .limit(1);
  if (pending) return { ok: true, number: pending.number, virtualAccount: pending.virtualAccount ?? undefined, reused: true };

  const [store] = await db
    .select({ accountId: schema.stores.accountId, slug: schema.stores.slug, firstInvoicePaid: schema.stores.firstInvoicePaid, name: schema.stores.name })
    .from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
  if (!store) return { ok: false, error: "Toko tidak ditemukan." };
  const [owner] = await db
    .select({ email: schema.users.email }).from(schema.storeUsers)
    .innerJoin(schema.users, eq(schema.users.id, schema.storeUsers.userId))
    .where(and(eq(schema.storeUsers.storeId, storeId), eq(schema.storeUsers.role, "owner"))).limit(1);

  const q = quote(cycle, store.firstInvoicePaid);
  const amount = withPpn(q.amount).total;
  const reffId = `SUB-${store.slug}-${Date.now().toString().slice(-8)}`;
  const callbackUrl = (process.env.PUBLIC_APP_URL ?? "http://localhost:3000") + "/api/public/pay/callback";
  const r = await alCreatePayment({ reffId, channelCode: "VABCA", amount, customerId: storeId, customerName: store.name, customerPhone: "081200000000", customerEmail: owner?.email ?? "merchant@tokophi.id", callbackUrl });
  if (!r.ok) return { ok: false, error: r.error ?? "Gagal membuat tagihan." };

  const number = "SUB-" + Date.now().toString().slice(-9);
  await db.insert(schema.invoices).values({
    number, accountId: store.accountId, storeId, planKey: "bisnis", amountIdr: amount, status: "menunggu",
    kind: "subscription", cycle: q.cycle, periodMonths: q.months, reffId, trxId: r.trxId, channel: "VABCA",
    virtualAccount: r.virtualAccount ?? null, qr: r.qr ?? null, paymentUrl: r.url ?? null,
  });
  await logStore(storeId, `Tagihan manual Rp${amount.toLocaleString("id-ID")} (${q.cycle === "annual" ? "tahunan" : "bulanan"}) dibuat oleh platform`);
  revalidatePath(`/toko/${storeId}`); revalidatePath("/paket");
  return { ok: true, number, virtualAccount: r.virtualAccount ?? undefined };
}

export async function sendPaymentReminder(storeId: string): Promise<{ ok: boolean; error?: string }> {
  await requirePlatformAdmin();
  const [pending] = await db
    .select({ number: schema.invoices.number })
    .from(schema.invoices)
    .where(and(eq(schema.invoices.storeId, storeId), eq(schema.invoices.status, "menunggu")))
    .limit(1);
  // (comms — email/WA — integrated later; recorded to the store audit for now)
  await logStore(storeId, pending ? `Pengingat pembayaran dikirim (tagihan ${pending.number})` : "Pengingat pembayaran dikirim ke merchant");
  revalidatePath(`/toko/${storeId}`);
  return { ok: true };
}

// ---- support tickets (platform side) ----
export async function replyTicketAdmin(ticketId: string, body: string): Promise<{ ok: boolean; error?: string }> {
  await requirePlatformAdmin();
  const b = body?.trim();
  if (!b) return { ok: false, error: "Pesan kosong." };
  await db.insert(schema.supportMessages).values({ ticketId, sender: "platform", body: b });
  await db.update(schema.supportTickets).set({ status: "answered", lastMessageAt: new Date() }).where(eq(schema.supportTickets.id, ticketId));
  revalidatePath("/tiket"); revalidatePath(`/tiket/${ticketId}`);
  return { ok: true };
}
export async function setTicketStatus(ticketId: string, status: "open" | "answered" | "closed"): Promise<{ ok: boolean }> {
  await requirePlatformAdmin();
  await db.update(schema.supportTickets).set({ status }).where(eq(schema.supportTickets.id, ticketId));
  revalidatePath("/tiket"); revalidatePath(`/tiket/${ticketId}`);
  return { ok: true };
}

// ============================================================================
// Per-store control (super-admin runs a merchant's account)
// ============================================================================

// Gratiskan N bulan (comp): extend the paid period at no charge (goodwill / compensation).
export async function compStore(storeId: string, months = 1): Promise<{ ok: boolean; until?: string }> {
  await requirePlatformAdmin();
  const [s] = await db.select({ currentPeriodEnd: schema.stores.currentPeriodEnd }).from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
  if (!s) return { ok: false };
  const now = new Date();
  const base = s.currentPeriodEnd && s.currentPeriodEnd > now ? s.currentPeriodEnd : now;
  const until = addMonths(base, months);
  await db.update(schema.stores).set({ currentPeriodEnd: until, status: "active", firstInvoicePaid: true }).where(eq(schema.stores.id, storeId));
  await logStore(storeId, `Gratis ${months} bulan diberikan (aktif s/d ${until.toLocaleDateString("id-ID")})`);
  revalidatePath(`/toko/${storeId}`); revalidatePath("/toko"); revalidatePath("/");
  return { ok: true, until: until.toISOString() };
}

// Extend / reset the free trial by N days from now.
export async function extendTrial(storeId: string, days = 7): Promise<{ ok: boolean }> {
  await requirePlatformAdmin();
  const until = new Date(Date.now() + days * 86_400_000);
  await db.update(schema.stores).set({ trialEndsAt: until, currentPeriodEnd: null, status: "trial", firstInvoicePaid: false }).where(eq(schema.stores.id, storeId));
  await logStore(storeId, `Trial diperpanjang ${days} hari (s/d ${until.toLocaleDateString("id-ID")})`);
  revalidatePath(`/toko/${storeId}`); revalidatePath("/toko"); revalidatePath("/");
  return { ok: true };
}

// VIP bypass: comped=true → no monthly charge (the "hapus langganan" one-door control).
export async function setStoreComped(storeId: string, comped: boolean, reason?: string): Promise<{ ok: boolean }> {
  await requirePlatformAdmin();
  const patch: Record<string, unknown> = { comped, compedReason: comped ? (reason?.trim() || "Dibebaskan platform") : null, compedAt: comped ? new Date() : null };
  if (comped) patch.status = "active"; // VIP is always active
  await db.update(schema.stores).set(patch).where(eq(schema.stores.id, storeId));
  await logStore(storeId, comped ? `Langganan dibebaskan (VIP) — ${reason?.trim() || "tanpa biaya bulanan"}` : "Status VIP dicabut — kembali ke langganan berbayar");
  revalidatePath(`/toko/${storeId}`); revalidatePath("/toko"); revalidatePath("/");
  return { ok: true };
}

// Reset the OWNER's password → returns a one-time temp password to hand over (scrypt-hashed at rest).
export async function resetOwnerPassword(storeId: string): Promise<{ ok: boolean; password?: string; email?: string }> {
  await requirePlatformAdmin();
  const [row] = await db
    .select({ userId: schema.storeUsers.userId, email: schema.users.email })
    .from(schema.storeUsers)
    .innerJoin(schema.users, eq(schema.users.id, schema.storeUsers.userId))
    .where(and(eq(schema.storeUsers.storeId, storeId), eq(schema.storeUsers.role, "owner")))
    .limit(1);
  if (!row) return { ok: false };
  const pw = tempPassword();
  await db.update(schema.users).set({ passwordHash: hashPassword(pw) }).where(eq(schema.users.id, row.userId));
  await logStore(storeId, `Password owner (${row.email}) direset oleh platform`);
  return { ok: true, password: pw, email: row.email };
}

// Reset ANY store user's password.
export async function resetStoreUserPassword(storeId: string, userId: string): Promise<{ ok: boolean; password?: string; email?: string }> {
  await requirePlatformAdmin();
  const [u] = await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!u) return { ok: false };
  const pw = tempPassword();
  await db.update(schema.users).set({ passwordHash: hashPassword(pw) }).where(eq(schema.users.id, userId));
  await logStore(storeId, `Password ${u.email} direset oleh platform`);
  return { ok: true, password: pw, email: u.email };
}

export async function setStoreUserRole(storeId: string, storeUserId: string, role: "owner" | "admin" | "staff" | "gudang"): Promise<{ ok: boolean }> {
  await requirePlatformAdmin();
  await db.update(schema.storeUsers).set({ role }).where(and(eq(schema.storeUsers.id, storeUserId), eq(schema.storeUsers.storeId, storeId)));
  revalidatePath(`/toko/${storeId}`);
  return { ok: true };
}

export async function removeStoreUser(storeId: string, storeUserId: string): Promise<{ ok: boolean; error?: string }> {
  await requirePlatformAdmin();
  const [su] = await db.select({ role: schema.storeUsers.role, email: schema.users.email })
    .from(schema.storeUsers).innerJoin(schema.users, eq(schema.users.id, schema.storeUsers.userId))
    .where(eq(schema.storeUsers.id, storeUserId)).limit(1);
  if (su?.role === "owner") return { ok: false, error: "Owner tidak bisa dihapus." };
  await db.delete(schema.storeUsers).where(and(eq(schema.storeUsers.id, storeUserId), eq(schema.storeUsers.storeId, storeId)));
  await logStore(storeId, `User ${su?.email ?? ""} dihapus dari toko oleh platform`);
  revalidatePath(`/toko/${storeId}`);
  return { ok: true };
}

export async function addStoreUser(storeId: string, input: { name: string; email: string; role: "admin" | "staff" | "gudang" }): Promise<{ ok: boolean; password?: string; error?: string }> {
  await requirePlatformAdmin();
  const email = input.email?.trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "Email tidak valid." };
  let [u] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email)).limit(1);
  const pw = tempPassword();
  if (!u) {
    [u] = await db.insert(schema.users).values({ email, name: input.name?.trim() || email, passwordHash: hashPassword(pw) }).returning({ id: schema.users.id });
  }
  const [dup] = await db.select({ id: schema.storeUsers.id }).from(schema.storeUsers).where(and(eq(schema.storeUsers.storeId, storeId), eq(schema.storeUsers.userId, u.id))).limit(1);
  if (dup) return { ok: false, error: "User sudah ada di toko ini." };
  await db.insert(schema.storeUsers).values({ storeId, userId: u.id, role: input.role, acceptedAt: new Date() });
  await logStore(storeId, `User ${email} (${input.role}) ditambahkan oleh platform`);
  revalidatePath(`/toko/${storeId}`);
  return { ok: true, password: pw };
}
