"use server";
import { db, schema } from "@tokophi/db";
import { and, eq, sql } from "drizzle-orm";
import { scryptSync, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { signImpersonation } from "./session";
import { requirePlatformAdmin } from "./platform-auth";
import { kaTestConnection, kaServices } from "@tokophi/lib/kiriminaja";
import { isInstantService } from "@tokophi/lib/couriers";
import { alTestConnection, alProbeChannels, alCreatePayment } from "@tokophi/lib/autolaris";
import { addMonths, quote, withPpn } from "@tokophi/lib/billing";

// Audit helper — record an operator action against a specific store (shown on the store detail).
async function logStore(storeId: string, text: string): Promise<void> {
  await db.insert(schema.platformActivity).values({ kind: "admin", text, storeId });
}
// …and for platform-wide operator actions that belong to no single store (e.g. payout policy).
async function logPlatform(text: string): Promise<void> {
  await db.insert(schema.platformActivity).values({ kind: "admin", text });
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
// Impersonation is the single most invasive thing an operator can do: it mints a merchant session
// and walks into their shop as them. It requires OWNER, and it is AUDITED — it previously required
// only "logged in" and left NO trace at all, so nobody could answer "who went into my store?".
export async function impersonateStore(storeId: string): Promise<{ ok: boolean; adminUrl?: string; error?: string }> {
  const admin = await requirePlatformAdmin("owner");
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
  await logStore(storeId, `Impersonate toko oleh ${admin.email}`);
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

// ---- provisioning: onboard a new merchant store (account + owner + store + membership + stats) ----
// No `plan`: there is ONE plan (TokoΦ). The legacy `plan` column keeps its DB default.
export type NewStoreInput = { name: string; ownerName: string; email: string; city: string };
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
    const [acc] = await tx.insert(schema.accounts).values({ name, createdAt: ANCHOR }).returning();
    const [u] = await tx.insert(schema.users).values({ email, name: ownerName, passwordHash: hashPassword(DEV_PASSWORD) }).returning();
    // new store → 3-day free trial (real clock)
    const trialEndsAt = new Date(Date.now() + 3 * 86_400_000);
    const [st] = await tx.insert(schema.stores).values({ accountId: acc.id, name, slug, city, status: "trial", trialEndsAt, firstInvoicePaid: false, createdAt: ANCHOR }).returning();
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

/**
 * Which SERVICES may carry COD. This is the platform's call, not the merchant's.
 *
 * COD is not SPX-only in the data — KiriminAja reports cod=true on 9 of 9 `regular` services. The
 * asymmetry that actually costs money is RETURNS: a refused COD parcel ships back free on SPX and
 * is billed to the merchant on the others. So the narrowing is a per-service boolean the platform
 * can flip, rather than `if (courier === "spx")` welded into the code — the day another courier
 * offers free returns, this becomes a tick box instead of a deploy.
 *
 * A service KiriminAja does not support COD on can never be switched on: `cod` is the ceiling.
 */
export async function saveCodAllowed(updates: { courier: string; type: string; allowed: boolean }[]): Promise<void> {
  await requirePlatformAdmin();
  const byCourier = new Map<string, Map<string, boolean>>();
  for (const u of updates) {
    const m = byCourier.get(u.courier) ?? new Map<string, boolean>();
    m.set(u.type, u.allowed);
    byCourier.set(u.courier, m);
  }

  const rows = await db.select().from(schema.platformCouriers);
  for (const row of rows) {
    const wanted = byCourier.get(row.courier);
    if (!wanted) continue;
    const services = (Array.isArray(row.services) ? row.services : []) as {
      type: string; name: string; group: string; cod: boolean; codAllowed?: boolean;
    }[];
    const next = services.map((s) =>
      typeof s === "object" && wanted.has(s.type)
        ? { ...s, codAllowed: s.cod && wanted.get(s.type)! } // KiriminAja's flag is the ceiling
        : s,
    );
    await db.update(schema.platformCouriers).set({ services: next }).where(eq(schema.platformCouriers.courier, row.courier));
  }
  revalidatePath("/pengaturan");
}

// ---- KiriminAja aggregator: live connectivity test (platform key) ----
export async function testKiriminajaConnection(): Promise<{ ok: boolean; env: string; provinces?: number; message: string }> {
  await requirePlatformAdmin();
  return kaTestConnection();
}

/**
 * Pull the REAL courier roster from KiriminAja into platform_couriers.
 *
 * The roster used to be a hand-written list (packages/lib/couriers.ts) and had drifted: it named
 * TIKI and Pos Indonesia, which KiriminAja does not return, and gave SPX the services
 * "Standard"/"Hemat" when the live service_types are "1" and "3". Merchants could switch on
 * services that do not exist, and the storefront filter would silently never match them.
 *
 * Now the API is the source of truth. Each service keeps KiriminAja's own `cod` flag plus a
 * platform `codAllowed` decision on top.
 *
 * ⚠️ `codAllowed` for a NEWLY DISCOVERED service defaults to **false**, not to KiriminAja's `cod`
 * flag. It used to default to the flag — which meant that clicking "Sync" (a *catalogue refresh*)
 * silently OPENED COD on every service KiriminAja happens to support. Proven on 2026-07-14: a sync
 * pulled in Jagopack and Sicepat CARGO and both came back COD-enabled, against a platform policy
 * that is deliberately SPX-only, with nobody having decided anything.
 *
 * COD is a MONEY decision, not a capability: KiriminAja reports cod=true on 13 of 20 services, but
 * when a COD buyer refuses the parcel SPX ships it back free while every other courier bills the
 * merchant for the return leg. A permission that costs money must be granted deliberately — so a new
 * service arrives switched OFF and the super-admin ticks the box. `cod` remains the ceiling (a
 * service KiriminAja will not COD can never be ticked).
 *
 * Re-syncing preserves the existing enabled/codAllowed decisions; only the service catalogue is
 * refreshed. A courier that disappears from KiriminAja is disabled, never deleted (stores may
 * still hold orders that reference it).
 */
export async function syncCouriersFromKiriminaja(): Promise<{ ok: boolean; couriers: number; services: number; message: string }> {
  await requirePlatformAdmin();

  const r = await kaServices();
  if (!r.ok || !r.services.length) {
    return { ok: false, couriers: 0, services: 0, message: r.error ?? "KiriminAja tidak mengembalikan layanan." };
  }

  const existing = await db.select().from(schema.platformCouriers);
  const prev = new Map(existing.map((e) => [e.courier, e]));

  // group the flat service list by courier
  const byCourier = new Map<string, { type: string; name: string; group: string; cod: boolean; codAllowed: boolean }[]>();
  for (const s of r.services) {
    // INSTANT COURIERS NEVER ENTER THE ROSTER (isInstantService — @tokophi/lib/couriers).
    // Instant delivery is out of scope for launch; the product ships via expedition couriers only.
    // KiriminAja's express endpoint does not return gosend/grab today, so this is a GUARD at the
    // source: if it ever did, the row would never be written and no store could offer it.
    if (isInstantService({ courier: s.courier, group: s.group })) continue;
    const old = (prev.get(s.courier)?.services as { type: string; codAllowed?: boolean }[] | null) ?? [];
    const keptDecision = old.find((o) => typeof o === "object" && o.type === s.serviceType)?.codAllowed;
    const list = byCourier.get(s.courier) ?? [];
    list.push({
      type: s.serviceType,
      name: s.name,
      group: s.group,
      cod: s.cod,
      // Keep the super-admin's previous decision. A service we have never seen before starts CLOSED
      // for COD — a catalogue refresh must not hand out a money-risk permission (see above).
      codAllowed: s.cod && (keptDecision ?? false),
    });
    byCourier.set(s.courier, list);
  }

  for (const [courier, services] of byCourier) {
    const was = prev.get(courier);
    if (was) {
      await db
        .update(schema.platformCouriers)
        .set({ services, enabled: was.enabled })
        .where(eq(schema.platformCouriers.courier, courier));
    } else {
      await db.insert(schema.platformCouriers).values({ courier, services, enabled: true });
    }
  }

  // couriers KiriminAja no longer offers: disable, don't delete (old orders still reference them)
  for (const e of existing) {
    if (!byCourier.has(e.courier) && e.enabled) {
      await db.update(schema.platformCouriers).set({ enabled: false }).where(eq(schema.platformCouriers.courier, e.courier));
    }
  }

  revalidatePath("/pengaturan");
  const stale = existing.filter((e) => !byCourier.has(e.courier)).map((e) => e.courier);
  return {
    ok: true,
    couriers: byCourier.size,
    services: r.services.length,
    message:
      `${byCourier.size} kurir · ${r.services.length} layanan disinkronkan dari KiriminAja.` +
      (stale.length ? ` Dinonaktifkan (tidak lagi ditawarkan): ${stale.join(", ")}.` : ""),
  };
}

// ---- AutoLaris payment gateway: live connectivity test ----
export async function testAutolarisConnection(): Promise<{ ok: boolean; message: string }> {
  await requirePlatformAdmin();
  return alTestConnection();
}

// ---- platform team: invite another operator (real platform_admins row) ----
/**
 * 🔴 This was a PRIVILEGE-ESCALATION PATH, and it quietly undid the role hierarchy added earlier
 * today. It required only `admin`, and it took `role` from the caller **unvalidated** —
 * `role: input.role || "admin"`. So any `admin` could invite themselves (or a colleague) as
 * `owner`, and `owner` is what gates impersonation and merchant password resets.
 *
 * A role check is worth nothing if the thing that HANDS OUT roles is not itself checked. Minting an
 * operator is an owner-level act, the role must be one we recognise, and it is now audited — it was
 * previously unlogged, so a self-promotion would have left no trace whatsoever.
 */
export async function invitePlatformAdmin(input: { name: string; email: string; role: string }): Promise<{ ok: boolean; error?: string }> {
  const admin = await requirePlatformAdmin("owner");

  const email = input.email?.trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "Email tidak valid." };

  // Whitelist, not a fallback. `input.role || "admin"` accepted literally anything.
  const role = String(input.role ?? "").trim();
  if (!["support", "admin", "owner"].includes(role)) {
    return { ok: false, error: "Peran tidak dikenal. Pilih support, admin, atau owner." };
  }

  const [dup] = await db.select({ id: schema.platformAdmins.id }).from(schema.platformAdmins).where(eq(schema.platformAdmins.email, email)).limit(1);
  if (dup) return { ok: false, error: "Email sudah terdaftar sebagai operator." };

  await db.insert(schema.platformAdmins).values({ email, name: input.name?.trim() || null, role, passwordHash: hashPassword(DEV_PASSWORD) });
  await logPlatform(`Operator ${email} ditambahkan sebagai ${role} oleh ${admin.email}`);
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
  // support_messages.store_id is denormalized (migration 0035) so RLS can key on it —
  // the platform runs on the owner connection (RLS bypassed) but must still fill it.
  const [t] = await db.select({ storeId: schema.supportTickets.storeId }).from(schema.supportTickets).where(eq(schema.supportTickets.id, ticketId)).limit(1);
  if (!t) return { ok: false, error: "Tiket tidak ditemukan." };
  await db.insert(schema.supportMessages).values({ ticketId, storeId: t.storeId, sender: "platform", body: b });
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
// Resetting a merchant's password hands over their account. Owner only.
export async function resetOwnerPassword(storeId: string): Promise<{ ok: boolean; password?: string; email?: string }> {
  await requirePlatformAdmin("owner");
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

// ============================================================================
// Pencairan (payouts) — the platform side of the merchant's "Tarik saldo"
// ============================================================================
//
// A merchant requests a payout from /saldo: that writes a `payouts` row (menunggu) AND a NEGATIVE
// `payout` ledger entry, so the money leaves their available pool immediately — it is spoken for.
// Nobody but an operator can move it from there. These four actions are that operator.
//
// THE RULE THAT GOVERNS ALL OF THIS: the book is append-only. Money is never edited in place. A
// payout that must be undone is undone with a NEW opposing entry, never by deleting or mutating the
// entry that took the money out — that entry is the record that we took it, and it stays.

const rupiah = (n: number) => "Rp" + n.toLocaleString("id-ID");

/** Menunggu → Diproses: the operator picked it up / initiated the bank transfer. */
export async function processPayout(payoutId: string): Promise<{ ok: boolean; error?: string }> {
  await requirePlatformAdmin();
  const r = await db.transaction(async (tx) => {
    const [p] = await tx.select().from(schema.payouts).where(eq(schema.payouts.id, payoutId)).for("update").limit(1);
    if (!p) return { ok: false as const, error: "Pencairan tidak ditemukan." };
    if (p.status !== "menunggu") return { ok: false as const, error: "Hanya pencairan berstatus Menunggu yang bisa diproses." };
    await tx.update(schema.payouts).set({ status: "diproses" }).where(eq(schema.payouts.id, payoutId));
    return { ok: true as const, storeId: p.storeId, amount: p.amountIdr };
  });
  if (!r.ok) return r;
  await logStore(r.storeId, `Pencairan ${rupiah(r.amount)} diproses (transfer bank dimulai)`);
  revalidatePath("/pencairan");
  revalidatePath(`/toko/${r.storeId}`);
  return { ok: true };
}

/**
 * Diproses → Selesai: the money left the platform's bank account.
 *
 * Nothing is posted to the ledger here — and that is correct. The merchant's balance was already
 * debited when they REQUESTED the payout; paying it out settles an obligation we had already
 * recorded. Crediting or debiting again here would double-count.
 */
export async function markPayoutPaid(payoutId: string): Promise<{ ok: boolean; error?: string }> {
  await requirePlatformAdmin();
  const r = await db.transaction(async (tx) => {
    const [p] = await tx.select().from(schema.payouts).where(eq(schema.payouts.id, payoutId)).for("update").limit(1);
    if (!p) return { ok: false as const, error: "Pencairan tidak ditemukan." };
    if (p.status === "selesai") return { ok: false as const, error: "Pencairan sudah lunas." };
    if (p.status === "gagal") return { ok: false as const, error: "Pencairan sudah ditolak — dananya sudah dikembalikan." };
    const paidAt = new Date();
    await tx.update(schema.payouts).set({ status: "selesai", paidAt }).where(eq(schema.payouts.id, payoutId));
    return { ok: true as const, storeId: p.storeId, amount: p.amountIdr };
  });
  if (!r.ok) return r;
  await logStore(r.storeId, `Pencairan ${rupiah(r.amount)} ditandai LUNAS — dana sudah ditransfer`);
  revalidatePath("/pencairan");
  revalidatePath(`/toko/${r.storeId}`);
  return { ok: true };
}

/**
 * → Gagal (tolak): the request is refused and THE MONEY MUST COME BACK.
 *
 * The negative `payout` entry that removed it from the available pool is still there, and it stays
 * there — it is a true record of what happened. The correction is a NEW, opposing `adjustment`
 * entry (positive, immediately `available`, carrying the same payout_id) posted beside it. Replay
 * the book and the two cancel out to zero: the merchant is exactly where they started.
 *
 * The reversal is computed from what the LEDGER actually holds for this payout — not from
 * payouts.amount_idr — so it is exact by construction and cannot over- or under-refund if the two
 * ever disagree. A payout already reversed nets to 0 and posts nothing.
 *
 * The payout row is SELECT … FOR UPDATE: two operators clicking Tolak at once would otherwise each
 * post a reversal and hand the merchant their money twice.
 */
export async function rejectPayout(payoutId: string, reason: string): Promise<{ ok: boolean; error?: string; restored?: number }> {
  await requirePlatformAdmin();
  const why = reason?.trim();
  if (!why) return { ok: false, error: "Alasan penolakan wajib diisi." };

  const r = await db.transaction(async (tx) => {
    const [p] = await tx.select().from(schema.payouts).where(eq(schema.payouts.id, payoutId)).for("update").limit(1);
    if (!p) return { ok: false as const, error: "Pencairan tidak ditemukan." };
    if (p.status === "selesai") return { ok: false as const, error: "Dana sudah ditransfer — pencairan lunas tidak bisa ditolak." };
    if (p.status === "gagal") return { ok: false as const, error: "Pencairan sudah ditolak." };

    // The net of every ledger entry tied to this payout (normally the single negative `payout` row).
    const rows = (await tx.execute(sql`
      select coalesce(sum(amount_idr), 0)::bigint as net from ledger_entries where payout_id = ${payoutId}
    `)) as unknown as { net: string | number }[];
    const net = Number(rows[0]?.net ?? 0);

    let restored = 0;
    if (net < 0) {
      restored = -net; // exactly what was taken out
      await tx.insert(schema.ledgerEntries).values({
        storeId: p.storeId,
        payoutId,
        kind: "adjustment",
        status: "available", // straight back into the available pool — the merchant can use it now
        amountIdr: restored,
        note: `Pembatalan penarikan: ${why}`,
        availableAt: new Date(),
      });
    }

    await tx.update(schema.payouts).set({ status: "gagal", note: why }).where(eq(schema.payouts.id, payoutId));
    return { ok: true as const, storeId: p.storeId, amount: p.amountIdr, restored };
  });
  if (!r.ok) return r;
  await logStore(r.storeId, `Pencairan ${rupiah(r.amount)} DITOLAK — “${why}” · saldo ${rupiah(r.restored)} dikembalikan ke merchant`);
  revalidatePath("/pencairan");
  revalidatePath(`/toko/${r.storeId}`);
  return { ok: true, restored: r.restored };
}

/**
 * Payout policy (`platform_payout`, single row).
 *
 * `release_on` decides WHEN a sale's money becomes withdrawable:
 *   - 'selesai'  — the order completed. Safe, and the default.
 *   - 'dikirim'  — the parcel shipped. DANGEROUS: a parcel can only be RETURNED after it shipped,
 *                  so the merchant can withdraw money for goods that come back. Worse, on COD the
 *                  cash does not exist yet at despatch — the courier collects at the door and
 *                  settles days later, so the platform would be paying out of its own pocket.
 * Kept as a setting rather than a constant so it can be loosened without a deploy — but it defaults
 * to the safe end on purpose, and the UI says so out loud.
 */
export async function savePayoutPolicy(input: { releaseOn: "selesai" | "dikirim"; minPayoutIdr: number }): Promise<{ ok: boolean; error?: string }> {
  await requirePlatformAdmin();
  if (input.releaseOn !== "selesai" && input.releaseOn !== "dikirim") return { ok: false, error: "Pilihan pelepasan dana tidak valid." };
  const min = Math.floor(Number(input.minPayoutIdr));
  if (!Number.isFinite(min) || min < 0) return { ok: false, error: "Minimum penarikan tidak valid." };

  // Single-row table — and it may never have been seeded, so upsert rather than assume.
  const [existing] = await db.select({ id: schema.platformPayout.id }).from(schema.platformPayout).limit(1);
  if (existing) {
    await db.update(schema.platformPayout).set({ releaseOn: input.releaseOn, minPayoutIdr: min }).where(eq(schema.platformPayout.id, existing.id));
  } else {
    await db.insert(schema.platformPayout).values({ releaseOn: input.releaseOn, minPayoutIdr: min });
  }
  await logPlatform(
    `Kebijakan pencairan diubah — dana dilepas saat pesanan "${input.releaseOn}", minimum penarikan ${rupiah(min)}` +
      (input.releaseOn === "dikirim" ? " ⚠️ (berisiko: retur & COD belum tentu tertagih)" : ""),
  );
  revalidatePath("/pencairan");
  return { ok: true };
}
