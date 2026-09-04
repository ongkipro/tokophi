"use server";
import { db, schema } from "@tokophi/db";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { platformGate } from "./platform-auth";
import { markPayoutPaidInTxn, type PayoutConflict } from "./payout-transition";
import { GRANT_TTL_SECONDS, grantExpiresAt, grantTokenHash, mintGrantToken } from "@tokophi/lib/impersonation";
import { tempPassword, hashPassword } from "@tokophi/lib/password";
import { kaTestConnection, kaServices } from "@tokophi/lib/kiriminaja";
import { isInstantService } from "@tokophi/lib/couriers";
import { alTestConnection, alProbeChannels, alCreateOrder } from "@tokophi/lib/autolaris";
import { BILLING, addMonths, quote, subscriptionCharge, withPpn, computeBilling, type BillingStatus } from "@tokophi/lib/billing";

import { payCallbackUrl } from "@tokophi/lib/pay-callback";
import { NAME_MAX, STORE_NAME_MIN, isReservedSlug, slugify } from "@tokophi/lib/store-slug";
import { uniqueViolationConstraint } from "@tokophi/lib/pg-errors";
// Audit helper — record an operator action against a specific store (shown on the store detail).
async function logStore(storeId: string, text: string): Promise<void> {
  await db.insert(schema.platformActivity).values({ kind: "admin", text, storeId });
}
// …and for platform-wide operator actions that belong to no single store (e.g. payout policy).
async function logPlatform(text: string): Promise<void> {
  await db.insert(schema.platformActivity).values({ kind: "admin", text });
}
// Every super-admin mutation is gated by `requirePlatformAdmin()` (the security boundary):
// impersonation + store lifecycle + provisioning + settings all require a platform-admin session.
//
// `tempPassword` / `hashPassword` live in `@tokophi/lib/password` — pure, testable, and the ONLY way
// a password is minted here. There is deliberately no password constant in this file. The mint is
// SHARED with `apps/admin` on purpose: it used to be copied, and the two copies had already drifted
// to different strengths (24 bits here, 32 there), with the weaker one on the store-owner path.

// `slugify` is `@tokophi/lib/store-slug` now. The private copy here did NOT normalise NFKD while
// the self-serve twin in `apps/admin/lib/provision.ts` did, so the two doors onto this product
// disagreed about a shop's permanent public address: measured, "Café Senja" → `caf-senja` here and
// `cafe-senja` there. Same reason the password mint was converged — a copy is how the weaker half
// survives a fix.

// Impersonate a store's owner: mint a ONE-TIME exchange and hand back the admin URL for the client
// to open. The admin's `/impersonate` spends the handle and sets the session cookie on ITS domain
// (cross-subdomain cookies are not shared, so we cannot set one from here).
//
// Impersonation is the single most invasive thing an operator can do: it opens a merchant's shop as
// them. It requires OWNER, and it is AUDITED — it previously required only "logged in" and left NO
// trace at all, so nobody could answer "who went into my store?".
//
// 🔴 WHAT CHANGED IN TASK 4.11 / SEC-10, AND WHY THE OLD SHAPE COULD NOT BE PATCHED. This used to
// mint a session-shaped JWT and put it in the query string. Signed, audience-pinned, two minutes to
// live — and REUSABLE for all 120 of those seconds by anyone holding the string, because a JWT is
// verified, never spent. A URL is the worst carrier there is for a bearer credential: browser
// history, the next request's `Referer`, a reverse-proxy access log, a screen share, a pasted ticket.
// The handle below is 256 opaque bits that mean nothing on their own; the FACTS live in a row only
// these two server processes can read, and the row is spent by one atomic UPDATE at the other end.
//
// ⚠️ THE ROW IS A PERMISSION TO EXCHANGE, NOT A CACHED FACT. Membership, the merchant's role, this
// operator's existence and this operator's rank are ALL re-read at consume time — the same rule the
// control plane already applies to its own cookie ("rank comes from `platform_admins`, on every
// request"), extended across the two-minute gap between minting a link and clicking it.
export async function impersonateStore(storeId: string): Promise<{ ok: boolean; adminUrl?: string; error?: string }> {
  const gate = await platformGate("owner");
  if (!gate.ok) return gate;
  const admin = gate.admin;
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

  // The plaintext handle exists HERE and in the URL below, and nowhere else — the row stores only
  // its sha256. Nothing logs it, and nothing can look it up afterwards.
  const token = mintGrantToken();
  await db.insert(schema.impersonationGrants).values({
    tokenHash: grantTokenHash(token),
    storeId: owner.storeId,
    userId: owner.userId,
    operatorId: admin.adminId,
    operatorEmail: admin.email,
    // The rank AT MINT TIME. The consume path refuses when the live row no longer matches, so a
    // demotion inside the exchange window kills the handle — without copying the rank ladder
    // (`platform-rank.ts`) into `apps/admin`, where a second copy is how the weaker half survives.
    operatorRole: admin.role,
    expiresAt: grantExpiresAt(),
  });
  // read at runtime (module-scope reads get baked at build time when the env is unset)
  const adminBase = process.env.ADMIN_URL ?? "http://localhost:3000";
  // ONE parameter. The slug used to ride along in the URL and no longer does: the grant row already
  // knows which store this is, and a destination taken from the query string is a redirect a caller
  // gets to choose.
  const url = `${adminBase}/impersonate?grant=${encodeURIComponent(token)}`;
  // Report what you WROTE: this created a link, it did not open anyone's panel. The other half of
  // the sentence — that somebody actually walked in — is logged by the consume path, or never.
  await logStore(storeId, `Tautan impersonate dibuat oleh ${admin.email} (sekali pakai, berlaku ${GRANT_TTL_SECONDS} detik)`);
  return { ok: true, adminUrl: url };
}

// ============================================================================
// Operator suspension — the platform locking a merchant's panel, deliberately
// ============================================================================
//
// 🔴 THE BUTTON DID NOTHING FOR MONTHS, AND SAID IT HAD WORKED. `setStoreStatus` wrote
// `stores.status` and an audit row reading "Toko ditangguhkan oleh platform". But whether a merchant
// is locked out is decided by `computeBilling()` (`@tokophi/lib/billing`), which read `comped`,
// `currentPeriodEnd` and `trialEndsAt` and **never `stores.status`** — so the suspended merchant
// kept a fully writable panel (measured: "Tambah Produk" present, a real save persisted), and the
// nightly billing cron rewrote the column back within 24 hours. Three separate lies: the toast, the
// audit entry, and the badge.
//
// The fix is a SEPARATE FACT, not a better write to the same column: `stores.suspended_at`, which
// `computeBilling` reads. Billing keeps running underneath. That is the point — the two must coexist:
//   · a store suspended for ABUSE that then pays its invoice must stay suspended;
//   · a store suspended for NON-PAYMENT must reactivate the moment it pays, without an operator;
//   · a VIP (comped) store must still be lockable — VIP bypasses billing, it is not an abuse shield.
//
// ⚠️ AND THE AUDIT ENTRY REPORTS AN OUTCOME, NOT AN INTENT. Both actions below re-read the row they
// just wrote (`.returning()`), recompute the effective state from it, and log THAT. The rule is
// already in AGENTS.md from `markLabelsPrinted`: report what you WROTE, never what you were asked to
// write. A store id that matches nothing updates zero rows, and now says so instead of logging a
// suspension that never happened.

// The billing columns `computeBilling` needs — one list, so a `returning()` cannot drift from the
// selects in the read layer.
const BILLING_COLS = {
  trialEndsAt: schema.stores.trialEndsAt,
  currentPeriodEnd: schema.stores.currentPeriodEnd,
  firstInvoicePaid: schema.stores.firstInvoicePaid,
  comped: schema.stores.comped,
  suspendedAt: schema.stores.suspendedAt,
  suspendedReason: schema.stores.suspendedReason,
} as const;

const EFFECTIVE_LABEL: Record<BillingStatus, string> = {
  active: "aktif",
  trial: "uji coba",
  past_due: "menunggak",
  suspended: "ditangguhkan",
};

// Re-read a store's billing columns and write `stores.status` from what is ACTUALLY there.
//
// `stores.status` is a denormalized cache (the nightly cron's job 1). Every action here used to set
// it optimistically — `status: "active"` beside a comp, a VIP toggle or a trial extension — which is
// how it came to disagree with the truth: "Gratiskan 1 bulan" on an operator-suspended store would
// stamp `active` on a panel that is still locked. Deriving it from the row we just wrote costs one
// SELECT and removes the whole class.
async function syncStoredStatus(storeId: string, tx: typeof db = db) {
  const [row] = await tx.select(BILLING_COLS).from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
  if (!row) return null;
  const state = computeBilling(row);
  await tx.update(schema.stores).set({ status: state.status }).where(eq(schema.stores.id, storeId));
  return state;
}

// Write the operator's suspension, then read back what the store ACTUALLY is now — in one
// transaction, so the column and the truth cannot disagree even for a moment, and so the audit line
// below is written from the re-read rather than from what we intended.
async function writeSuspension(storeId: string, suspendedAt: Date | null, reason: string | null) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(schema.stores)
      .set({ suspendedAt, suspendedReason: suspendedAt ? reason : null })
      .where(eq(schema.stores.id, storeId))
      .returning({ ...BILLING_COLS, name: schema.stores.name });
    if (!row) return null; // no such store — nothing was written, so nothing gets logged
    const state = computeBilling(row);
    await tx.update(schema.stores).set({ status: state.status }).where(eq(schema.stores.id, storeId));
    return { row, state };
  });
}

function revalidateStore(storeId: string) {
  revalidatePath("/toko");
  revalidatePath(`/toko/${storeId}`);
  revalidatePath("/");
}

export type SuspensionResult = { ok: boolean; error?: string; message?: string; effective?: BillingStatus };

// Lock a merchant's panel. Reads-stay-up: the storefront keeps selling, only the Seller panel's
// writes are refused (`requireCapability` → SuspendedError).
export async function suspendStore(storeId: string, reason: string): Promise<SuspensionResult> {
  const gate = await platformGate();
  if (!gate.ok) return gate;
  const admin = gate.admin;
  const why = reason?.trim();
  // A suspension with no stated reason is one nobody can review, appeal or lift with confidence —
  // and the merchant is shown this string, so "because" is not good enough.
  if (!why || why.length < 5) return { ok: false, error: "Tulis alasan penangguhan (minimal 5 karakter) — alasannya ditampilkan ke pemilik toko." };

  const res = await writeSuspension(storeId, new Date(), why);
  if (!res) return { ok: false, error: "Toko tidak ditemukan — tidak ada yang diubah." };

  await logStore(storeId, `Toko DITANGGUHKAN oleh ${admin.email} — alasan: ${why}. Hasil: panel Seller terkunci (tulis ditolak), status efektif "${EFFECTIVE_LABEL[res.state.status]}"; storefront tetap jalan.`);
  revalidateStore(storeId);
  return { ok: true, effective: res.state.status, message: `“${res.row.name}” ditangguhkan — panel Seller terkunci (baca-saja).` };
}

// Lift the operator's suspension. It restores the BILLING-DERIVED state and nothing more — it does
// not grant free time. So a store that was also overdue stays locked, for the other reason, and the
// operator is told so instead of being shown a success message over a panel that is still read-only.
// (Granting time is what "Gratiskan 1 bulan" is for; making the operator decide billing here would
// hide a month of revenue behind a button labelled "Aktifkan".)
export async function liftSuspension(storeId: string): Promise<SuspensionResult> {
  const gate = await platformGate();
  if (!gate.ok) return gate;
  const admin = gate.admin;
  const res = await writeSuspension(storeId, null, null);
  if (!res) return { ok: false, error: "Toko tidak ditemukan — tidak ada yang diubah." };
  // A human unlocking a store IS a review, so an operator who reaches for "Aktifkan" on a store that
  // was still in the signup queue must not leave it unstamped: `approved_at` would stay NULL, and the
  // next suspension — for cause — would then tell that merchant they are merely "menunggu
  // persetujuan". `coalesce` so a genuine approval date is never overwritten by a later lift.
  await db
    .update(schema.stores)
    .set({ approvedAt: sql`coalesce(${schema.stores.approvedAt}, now())` })
    .where(eq(schema.stores.id, storeId));

  const st = res.state.status;
  const stillLocked = res.state.readOnly;
  await logStore(
    storeId,
    stillLocked
      ? `Penangguhan platform DICABUT oleh ${admin.email}. Hasil: toko MASIH terkunci — status efektif "${EFFECTIVE_LABEL[st]}" (langganan belum lunas), bukan aktif.`
      : `Penangguhan platform DICABUT oleh ${admin.email}. Hasil: panel Seller kembali bisa menulis, status efektif "${EFFECTIVE_LABEL[st]}".`,
  );
  revalidateStore(storeId);
  return {
    ok: true,
    effective: st,
    message: stillLocked
      ? `Penangguhan dicabut, tapi “${res.row.name}” masih baca-saja: langganan ${EFFECTIVE_LABEL[st]}. Beri "Gratiskan 1 bulan" atau tunggu pembayaran.`
      : `“${res.row.name}” aktif kembali — panel Seller bisa menulis lagi.`,
  };
}

/**
 * Approve a store that came in through self-serve signup — the review queue's only exit (0090).
 *
 * Separate from `liftSuspension` on purpose, though both clear `suspended_at`. Three reasons:
 *  1. **It stamps `approved_at`**, which is what keeps an approved store OUT of the queue forever
 *     after. A later suspension for cause keeps the stamp, so the queue never re-fills with shops a
 *     human has already looked at.
 *  2. **The audit line is a different sentence.** "Penangguhan DICABUT" describes undoing a penalty;
 *     nobody penalised this store. `platform_activity` is what the operator reads back later to
 *     answer "who let this shop in?", and the two acts must not be indistinguishable there.
 *  3. **It refuses a store that is not in the queue.** Pointing this at a store suspended for abuse
 *     would silently launder that suspension into an approval.
 *
 * `admin` rank, not `owner`: reviewing a signup is day-to-day operator work, the same tier as
 * suspending and lifting. It is not an account handover.
 */
export async function approveStore(storeId: string): Promise<SuspensionResult> {
  const gate = await platformGate();
  if (!gate.ok) return gate;
  const admin = gate.admin;

  const [before] = await db
    .select({ approvedAt: schema.stores.approvedAt, suspendedAt: schema.stores.suspendedAt, name: schema.stores.name })
    .from(schema.stores)
    .where(eq(schema.stores.id, storeId))
    .limit(1);
  if (!before) return { ok: false, error: "Toko tidak ditemukan — tidak ada yang diubah." };
  if (before.approvedAt) {
    return { ok: false, error: `“${before.name}” sudah pernah disetujui. Untuk membuka penangguhan, pakai “Aktifkan”.` };
  }

  const res = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(schema.stores)
      .set({ approvedAt: new Date(), suspendedAt: null, suspendedReason: null })
      .where(eq(schema.stores.id, storeId))
      .returning({ ...BILLING_COLS, approvedAt: schema.stores.approvedAt, name: schema.stores.name });
    if (!row) return null;
    // Report what we WROTE, not what we asked for — same rule as `writeSuspension` above.
    const state = computeBilling(row);
    await tx.update(schema.stores).set({ status: state.status }).where(eq(schema.stores.id, storeId));
    return { row, state };
  });
  if (!res) return { ok: false, error: "Toko tidak ditemukan — tidak ada yang diubah." };

  await logStore(storeId, `Pendaftaran DISETUJUI oleh ${admin.email}. Status efektif "${EFFECTIVE_LABEL[res.state.status]}".`);
  revalidateStore(storeId);
  return { ok: true, effective: res.state.status, message: `“${res.row.name}” disetujui — panel Seller-nya bisa menulis sekarang.` };
}

// ---- provisioning: onboard a new merchant store (account + owner + store + membership + stats) ----
// No `plan`: there is ONE plan (TokoΦ). The legacy `plan` column keeps its DB default.
//
// 🔴 THE OWNER PASSWORD IS RANDOM AND REVEALED ONCE — it used to be the literal `tokophi123`.
// Every merchant onboarded from here got a `users` row hashed from a string published in this repo,
// so their email address alone was a working OWNER login at app.tokophi.com. The caller
// (`toko-client.tsx`) MUST surface `password`: nothing else can read it back, so an ignored return
// value is a merchant who cannot log in and nobody able to say why.
//
// Timestamps are the REAL CLOCK. `created_at`/`accepted_at` were stamped with the seed's frozen
// ANCHOR (2026-07-02) while `trialEndsAt` came from `Date.now()`, so a store was born ~30 days old
// with a 3-day trial in one INSERT. Same rule as `health.ts` and the discount editor: the seed may be
// anchored, the app never is. The columns default to `now()`, so they are simply not set here (this
// is what `apps/admin/lib/provision.ts`, the self-serve twin of this function, already did).
export type NewStoreInput = { name: string; ownerName: string; email: string; city: string };
export async function createStore(input: NewStoreInput): Promise<{ ok: boolean; storeId?: string; password?: string; error?: string }> {
  const gate = await platformGate();
  if (!gate.ok) return gate;
  const name = input.name?.trim();
  const email = input.email?.trim().toLowerCase();
  const ownerName = input.ownerName?.trim() || name;
  const city = input.city?.trim() || null;
  if (!name || !email) return { ok: false, error: "Nama toko & email pemilik wajib diisi." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "Format email tidak valid." };
  if (name.length < STORE_NAME_MIN) return { ok: false, error: `Nama toko minimal ${STORE_NAME_MIN} karakter.` };
  if (name.length > NAME_MAX) return { ok: false, error: `Nama toko maksimal ${NAME_MAX} karakter.` };
  if (ownerName.length > NAME_MAX) return { ok: false, error: `Nama pemilik maksimal ${NAME_MAX} karakter.` };
  const slug = slugify(name);
  if (!slug) return { ok: false, error: "Nama toko tidak valid." };
  // The storefront refuses to RESOLVE these as a store (`app`, `rich`, `www`, …), so writing one
  // here mints a shop that 404s on its own subdomain. The self-serve path skips to `<slug>-2`; an
  // operator typing a name by hand gets told, because they can simply pick another one.
  if (isReservedSlug(slug)) return { ok: false, error: `Nama toko itu dipakai platform (slug "${slug}"). Pilih nama lain.` };

  const [dupEmail] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (dupEmail) return { ok: false, error: "Email sudah dipakai pengguna lain." };
  const [dupSlug] = await db.select({ id: schema.stores.id }).from(schema.stores).where(eq(schema.stores.slug, slug)).limit(1);
  if (dupSlug) return { ok: false, error: `Nama toko bentrok (slug "${slug}" sudah ada).` };

  const pw = tempPassword();
  // The two `dup*` checks above are unlocked reads followed by a write, so a second operator (or the
  // self-serve path) can take either value in between. `users.email` and `stores.slug` are both
  // UNIQUE, so the data is never wrong — but the throw surfaced as a Next error digest on a form that
  // otherwise answers in sentences. The constraint is the lock; this reports it.
  let storeId: string;
  try {
    storeId = await insertStore();
  } catch (e) {
    const constraint = uniqueViolationConstraint(e);
    if (constraint === "users_email_unique") return { ok: false, error: "Email sudah dipakai pengguna lain." };
    if (constraint !== null) return { ok: false, error: `Nama toko bentrok (slug "${slug}" sudah ada).` };
    throw e;
  }
  await logStore(storeId, `Toko dibuat oleh platform: ${name} (${slug}), pemilik ${email}`);
  revalidatePath("/toko");
  revalidatePath("/");
  return { ok: true, storeId, password: pw };

  async function insertStore(): Promise<string> {
    return db.transaction(async (tx) => {
      const [acc] = await tx.insert(schema.accounts).values({ name }).returning();
      const [u] = await tx.insert(schema.users).values({ email, name: ownerName, passwordHash: hashPassword(pw) }).returning();
      // new store → free trial from the real clock (same length as the self-serve signup)
      const trialEndsAt = new Date(Date.now() + BILLING.TRIAL_DAYS * 86_400_000);
      // `catalogIdScheme: "number"` — ADR 0013: a store created now has no catalog anywhere yet, so it
      // starts on the stable id and never pays the one-way re-key. Must match lib/provision.ts.
      // `approvedAt` set here on purpose: an operator typing a merchant in by hand HAS vetted them,
      // so this path stays instant and never enters the signup review queue (0090). The queue is for
      // `apps/admin/lib/provision.ts`, the self-serve door, where nobody has proved anything.
      const [st] = await tx.insert(schema.stores).values({ accountId: acc.id, name, slug, city, status: "trial", trialEndsAt, firstInvoicePaid: false, catalogIdScheme: "number", approvedAt: new Date() }).returning();
      // ⚠️ `acceptedAt` IS CORRECT HERE, and it is the one place it is. This row is the shop's own
      // owner, created together with the shop — there was no invitation to accept, and the account
      // exists because this statement made it. `addStoreUser` (an operator adding SOMEBODY ELSE)
      // must not stamp it: there, the person has not been anywhere near the product yet.
      await tx.insert(schema.storeUsers).values({ storeId: st.id, userId: u.id, role: "owner", acceptedAt: new Date() });
      await tx.insert(schema.locations).values({ storeId: st.id, name: "Gudang Utama", isDefault: true });
      await tx.insert(schema.storeSettings).values({ storeId: st.id });
      await tx.insert(schema.storeStats).values({ storeId: st.id, gmvIdr: 0, ordersCount: 0, productsCount: 0 });
      return st.id;
    });
  }
}

// ---- billing: mark an invoice paid / failed / pending ----
//
// 🔵 THIS IS BOOKKEEPING ONLY. IT DOES NOT MOVE THE STORE'S SUBSCRIPTION, AND THAT IS THE DECISION,
// NOT AN OVERSIGHT (owner ruling, 2026-08-20).
//
// The comment that used to sit here said the opposite — "an operator flipping an invoice to
// `dibayar` by hand EXTENDS a store's paid period without a payment" — and it was simply false.
// There are exactly THREE writers of `stores.current_period_end` in the whole repo
// (`api/public/pay/callback`, `compStore`, `extendTrial`) and this is none of them. So the belief
// was in the code, in the audit trail and on the operator's screen, while the merchant's panel
// stayed read-only. The operator would then press "Gratiskan 1 bulan" to unlock them, which records
// a COMP — a giveaway — for a month the merchant had actually paid for.
//
// The asymmetry is deliberate and follows from the same ruling: walking a paid invoice back to
// `gagal` does NOT claw back a period the callback already granted. Entitlement moves on PAYMENT
// EVENTS, never on a ledger correction — so the screen and the audit line must both say so, rather
// than leaving the next reader to infer that money changed hands and a subscription moved with it.
// Granting time is what "Gratiskan 1 bulan" is for; taking it is what a suspension is for.
export async function setInvoiceStatus(number: string, status: "dibayar" | "menunggu" | "gagal"): Promise<{ ok: boolean; error?: string }> {
  const gate = await platformGate();
  if (!gate.ok) return gate;
  // Report what the UPDATE matched, not what was asked for — same rule as `markLabelsPrinted`. This
  // wrote blind and always answered `ok`, so a number that matches nothing rendered as a successful
  // correction AND wrote an audit line for it.
  const [inv] = await db
    .update(schema.invoices)
    .set({ status })
    .where(eq(schema.invoices.number, number))
    .returning({ storeId: schema.invoices.storeId });
  if (!inv) return { ok: false, error: "Faktur tidak ditemukan." };
  // An unlogged money-adjacent mutation is indistinguishable from an attack, so it must leave a
  // trace — and the trace has to be as honest as the screen: it names this as a bookkeeping change
  // so nobody later reads it as evidence that the store's subscription moved.
  const line = `Status faktur ${number} diubah → ${status} (manual, platform — pembukuan saja, masa aktif toko tidak berubah)`;
  if (inv.storeId) await logStore(inv.storeId, line);
  else await logPlatform(line);
  revalidatePath("/paket");
  revalidatePath("/");
  return { ok: true };
}

// ---- platform settings: persist gateway / courier toggles (were fake-saved before) ----
// Live-probe AutoLaris, persist `active` per channel, and auto-enable the active ones.
// EXPENSIVE (one create_payment per channel) — super-admin on-demand only.
export async function syncPaymentChannels(): Promise<{ ok: boolean; error?: string }> {
  const gate = await platformGate();
  if (!gate.ok) return gate;
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
  return { ok: true };
}

// Persist the enable/disable toggles (what's offered at checkout).
export async function savePaymentChannels(updates: { key: string; on: boolean }[]): Promise<{ ok: boolean; error?: string }> {
  const gate = await platformGate();
  if (!gate.ok) return gate;
  // ⚠️ THIS IS THE ONE PLATFORM-CONFIG WRITE THAT LEFT NO AUDIT LINE (page-map sweep SA-4). It flips
  // `platform_payment_channels.enabled` — the half checkout ENFORCES — while `saveGateways`,
  // `saveCouriers` and `saveCodAllowed` each `logPlatform`, and `saveCouriers`'s own comment records
  // a day of forensics caused by exactly this silence. Log what was WRITTEN (`.returning()`), by
  // label, so "who switched QRIS off?" has an answer on `/log-sistem`.
  const changed: string[] = [];
  for (const u of updates) {
    const rows = await db
      .update(schema.platformPaymentChannels)
      .set({ enabled: u.on })
      .where(eq(schema.platformPaymentChannels.channel, u.key))
      .returning({ label: schema.platformPaymentChannels.label });
    for (const r of rows) changed.push(`${r.label} ${u.on ? "ON" : "OFF"}`);
  }
  if (changed.length) await logPlatform(`Kanal pembayaran diubah oleh ${gate.admin.email}: ${changed.join(", ")}`);
  revalidatePath("/pengaturan");
  return { ok: true };
}

// ⚠️ ONLY THE `cod` BRANCH OF THIS IS ENFORCED. `platform_cod.enabled` is read by `lib/cod.ts`,
// `cod-policy.ts` and the storefront catalog; `platform_payment_gateways.enabled` is read by NOTHING
// on any payment path — checkout gates on `autolarisConfigured()` (env key) ∧
// `platform_payment_channels.enabled`. The column is kept rather than dropped (destructive
// migration) but it is a record, not a switch (owner ruling, 2026-08-20). Its one reader was an
// "Aktif" badge on the settings screen, now removed: a status light wired to nothing is worse than
// no light, because it can read green over a PSP that cannot take a rupiah.
export async function saveGateways(updates: { key: string; on: boolean }[]): Promise<{ ok: boolean; error?: string }> {
  const gate = await platformGate();
  if (!gate.ok) return gate;
  for (const u of updates) {
    if (u.key === "cod") await db.update(schema.platformCod).set({ enabled: u.on });
    // The provider union was hand-copied and had gone stale: it listed midtrans/xendit/duitku and
    // omitted `autolaris`, the ONLY provider this screen actually renders — so the cast was silencing
    // the type checker over the one value that reaches it. Derived from the enum now.
    else await db.update(schema.platformPaymentGateways).set({ enabled: u.on }).where(eq(schema.platformPaymentGateways.provider, u.key as (typeof schema.gatewayProvider.enumValues)[number]));
  }
  if (updates.length) await logPlatform(`Gateway pembayaran diubah: ${updates.map((u) => `${u.key}=${u.on ? "aktif" : "nonaktif"}`).join(", ")}`);
  revalidatePath("/pengaturan");
  return { ok: true };
}

export async function saveCouriers(updates: { key: string; on: boolean }[]): Promise<{ ok: boolean; error?: string }> {
  const gate = await platformGate();
  if (!gate.ok) return gate;
  for (const u of updates) await db.update(schema.platformCouriers).set({ enabled: u.on }).where(eq(schema.platformCouriers.courier, u.key));
  // The ONE writer that flips a courier on/off platform-wide — and until 2026-08-12 the only action
  // on this card that never logged. That silence made "is prod's idx/jtcargo/ninja state an operator
  // decision or seed residue?" structurally unanswerable from platform_activity; a day of forensics
  // (xmin bracketing + seed-epoch archaeology) answered what one log line would have. Same shape as
  // saveGateways'/saveCodAllowed's entries.
  if (updates.length) await logPlatform(`Kurir diubah: ${updates.map((u) => `${u.key}=${u.on ? "aktif" : "nonaktif"}`).join(", ")}`);
  revalidatePath("/pengaturan");
  return { ok: true };
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
export async function saveCodAllowed(updates: { courier: string; type: string; allowed: boolean }[]): Promise<{ ok: boolean; error?: string }> {
  const gate = await platformGate();
  if (!gate.ok) return gate;
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
  // COD risk policy: which services may carry cash on delivery is the lever that decides who eats a
  // refused-parcel return. A change here is a platform risk decision and must be auditable.
  if (updates.length) await logPlatform(`Izin COD per-layanan diubah: ${updates.map((u) => `${u.courier}/${u.type}=${u.allowed ? "boleh" : "tidak"}`).join(", ")}`);
  revalidatePath("/pengaturan");
  return { ok: true };
}

// ---- KiriminAja aggregator: live connectivity test (platform key) ----
export async function testKiriminajaConnection(): Promise<{ ok: boolean; env?: string; provinces?: number; message: string }> {
  // These three report through `message`, not `error` — their callers print one string either way.
  // A refusal that arrives with no `message` renders as an empty red toast, which is the N48 bug
  // again one layer down, so it is translated into the shape THIS caller reads.
  const gate = await platformGate();
  if (!gate.ok) return { ok: false, message: gate.error };
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
  const gate = await platformGate();
  if (!gate.ok) return { ok: false, couriers: 0, services: 0, message: gate.error };

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
  const gate = await platformGate();
  if (!gate.ok) return { ok: false, message: gate.error };
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
export async function invitePlatformAdmin(input: { name: string; email: string; role: string }): Promise<{ ok: boolean; error?: string; password?: string }> {
  const gate = await platformGate("owner");
  if (!gate.ok) return gate;
  const admin = gate.admin;

  const email = input.email?.trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "Email tidak valid." };

  // Whitelist, not a fallback. `input.role || "admin"` accepted literally anything.
  const role = String(input.role ?? "").trim();
  if (!["support", "admin", "owner"].includes(role)) {
    return { ok: false, error: "Peran tidak dikenal. Pilih support, admin, atau owner." };
  }

  const [dup] = await db.select({ id: schema.platformAdmins.id }).from(schema.platformAdmins).where(eq(schema.platformAdmins.email, email)).limit(1);
  if (dup) return { ok: false, error: "Email sudah terdaftar sebagai operator." };

  // ⚠️ A RANDOM password, revealed ONCE — never a constant. (The `DEV_PASSWORD = "tokophi123"` this
  // once used is gone from the file entirely; `createStore` was still on it until 2026-08-01.)
  //
  // Every operator minted here used to get the fixed `tokophi123`, never revealed and never forced to
  // change, so an email address plus a well-known default was a working login to the CONTROL PLANE —
  // the surface that reaches every tenant. The store-user add flow already does it this way; this one
  // did not. Same helper, same one-time hand-over.
  const pw = tempPassword();
  await db.insert(schema.platformAdmins).values({ email, name: input.name?.trim() || null, role, passwordHash: hashPassword(pw) });
  await logPlatform(`Operator ${email} ditambahkan sebagai ${role} oleh ${admin.email}`);
  revalidatePath("/pengaturan");
  return { ok: true, password: pw };
}

/**
 * Reset ANOTHER operator's control-plane password — N47, the way back in.
 *
 * 🔴 AN OPERATOR WHO FORGOT THEIR PASSWORD HAD NO WAY BACK IN. `changePlatformPassword` is
 * self-service and re-proves the CURRENT password, so it is exactly the door someone locked out
 * cannot open; `invitePlatformAdmin` only INSERTs, so it refuses a known email. That left one
 * documented recovery — an owner hand-editing `platform_admins` with `psql` on the production
 * container — and if the locked-out account was the last `owner`, the control plane had nobody who
 * could impersonate a merchant or reset a merchant's password until someone reached the database.
 *
 * There is no email out of this system (`sendPaymentReminder` writes a log line and says so on
 * screen), so a reset LINK would be a door that opens onto nothing. Same hand-over as every other
 * credential here instead: a random password, shown once, handed over out of band.
 *
 * ⚠️ NOT the caller's own row. Writing `password_hash` fires migration 0088's trigger, which stamps
 * `password_changed_at` and revokes every session that password opened — including the tab that
 * pressed the button. `changePlatformPassword` survives that by minting a replacement cookie, and it
 * has earned the right to: the person there proved they know the current password. Here nobody
 * proved anything, so a self-reset would log the operator out with a toast that says "berhasil".
 * The self-service dialog is one click away in the shell; point at it.
 */
export async function resetPlatformAdminPassword(adminId: string): Promise<{ ok: boolean; password?: string; email?: string; error?: string }> {
  const gate = await platformGate("owner");
  if (!gate.ok) return gate;
  if (adminId === gate.admin.adminId) {
    return { ok: false, error: "Untuk akun Anda sendiri, pakai “Ubah kata sandi” — reset di sini akan mengeluarkan Anda." };
  }
  const [target] = await db
    .select({ email: schema.platformAdmins.email, role: schema.platformAdmins.role })
    .from(schema.platformAdmins)
    .where(eq(schema.platformAdmins.id, adminId))
    .limit(1);
  if (!target) return { ok: false, error: "Operator tidak ditemukan." };

  const pw = tempPassword();
  await db.update(schema.platformAdmins).set({ passwordHash: hashPassword(pw) }).where(eq(schema.platformAdmins.id, adminId));
  // Handing over a control-plane credential reaches every tenant. Audited like the invite above —
  // and the revocation is stated, because it is what the target will experience.
  await logPlatform(`Password operator ${target.email} (${target.role}) direset oleh ${gate.admin.email} — semua sesi lamanya dicabut`);
  revalidatePath("/pengaturan");
  return { ok: true, password: pw, email: target.email };
}

// ---- manual billing: create a VA invoice for a store + payment reminder ----
export async function createManualInvoice(storeId: string, cycle: "monthly" | "annual" = "monthly"): Promise<{ ok: boolean; number?: string; virtualAccount?: string; reused?: boolean; error?: string }> {
  const gate = await platformGate();
  if (!gate.ok) return gate;
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
  // Platform PPN toggle (0101, owner ruling 2026-08-24) — same gate as the cron and the merchant's
  // own pay flow, read from platform_finance so all three creators can never disagree.
  const [finRow] = await db.select({ on: schema.platformFinance.subscriptionPpnEnabled }).from(schema.platformFinance).where(eq(schema.platformFinance.id, 1)).limit(1);
  const charge = subscriptionCharge(q.amount, finRow?.on ?? false);
  const amount = charge.total;
  const reffId = `SUB-${store.slug}-${Date.now().toString().slice(-8)}`;
  const callbackUrl = payCallbackUrl(reffId);
  // AL-ORDER: digital order (courir_id=1) — same contract as the merchant pay flow; see alCreateOrder.
  const r = await alCreateOrder({ reffId, channelCode: "VABCA", amount, customerName: store.name, customerPhone: "081200000000", customerEmail: owner?.email ?? "merchant@tokophi.id", callbackUrl, items: [{ name: "Langganan TokoPhi (manual)", qty: 1, unitPrice: amount }] });
  if (!r.ok) return { ok: false, error: r.error ?? "Gagal membuat tagihan." };

  const number = "SUB-" + Date.now().toString().slice(-9);
  await db.insert(schema.invoices).values({
    number, accountId: store.accountId, storeId, planKey: "bisnis", amountIdr: amount, taxIdr: charge.taxIdr, status: "menunggu",
    kind: "subscription", cycle: q.cycle, periodMonths: q.months, reffId, trxId: r.trxId, channel: "VABCA",
    virtualAccount: r.virtualAccount ?? null, qr: r.qr ?? null, paymentUrl: r.url ?? null,
  });
  await logStore(storeId, `Tagihan manual Rp${amount.toLocaleString("id-ID")} (${q.cycle === "annual" ? "tahunan" : "bulanan"}) dibuat oleh platform`);
  revalidatePath(`/toko/${storeId}`); revalidatePath("/paket");
  return { ok: true, number, virtualAccount: r.virtualAccount ?? undefined };
}

export async function sendPaymentReminder(storeId: string): Promise<{ ok: boolean; error?: string }> {
  const gate = await platformGate();
  if (!gate.ok) return gate;
  const [pending] = await db
    .select({ number: schema.invoices.number })
    .from(schema.invoices)
    .where(and(eq(schema.invoices.storeId, storeId), eq(schema.invoices.status, "menunggu")))
    .limit(1);
  // No automated comms yet (email/WA integrated later) — this only records a follow-up marker in the
  // store audit. Say "dicatat", not "dikirim": nothing is actually sent, and claiming otherwise is the
  // same trap as showing WA "terkirim" when we can only observe "dibuka".
  await logStore(storeId, pending ? `Pengingat pembayaran dicatat (tagihan ${pending.number})` : "Pengingat pembayaran dicatat");
  revalidatePath(`/toko/${storeId}`);
  return { ok: true };
}

// ---- support tickets (platform side) ----
export async function replyTicketAdmin(ticketId: string, body: string): Promise<{ ok: boolean; error?: string }> {
  const gate = await platformGate();
  if (!gate.ok) return gate;
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
export async function setTicketStatus(ticketId: string, status: "open" | "answered" | "closed"): Promise<{ ok: boolean; error?: string }> {
  const gate = await platformGate();
  if (!gate.ok) return gate;
  // Report what the UPDATE matched. A ticket id that no longer exists wrote nothing and still
  // answered `ok`, which the screen renders as "Tiket ditutup." The caller already reads `refused()`;
  // it was only ever handed a success.
  const rows = await db
    .update(schema.supportTickets)
    .set({ status })
    .where(eq(schema.supportTickets.id, ticketId))
    .returning({ id: schema.supportTickets.id });
  if (!rows.length) return { ok: false, error: "Tiket tidak ditemukan." };
  revalidatePath("/tiket"); revalidatePath(`/tiket/${ticketId}`);
  return { ok: true };
}

// ============================================================================
// Per-store control (super-admin runs a merchant's account)
// ============================================================================

// Gratiskan N bulan (comp): extend the paid period at no charge (goodwill / compensation).
export async function compStore(storeId: string, months = 1): Promise<{ ok: boolean; until?: string; error?: string }> {
  const gate = await platformGate();
  if (!gate.ok) return gate;
  const [s] = await db.select({ currentPeriodEnd: schema.stores.currentPeriodEnd }).from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
  if (!s) return { ok: false };
  const now = new Date();
  const base = s.currentPeriodEnd && s.currentPeriodEnd > now ? s.currentPeriodEnd : now;
  const until = addMonths(base, months);
  // ⚠️ `firstInvoicePaid` IS DELIBERATELY NOT TOUCHED. It used to be set `true` here, which BURNED the
  // Rp50rb first-month promo as a side effect of a goodwill gesture: comp a store still on its trial
  // and its first real invoice becomes Rp305.250 instead of Rp55.500 — Rp249.750 too much, charged to
  // the merchant we were trying to compensate. `computeBilling` reads `active` from
  // `currentPeriodEnd` alone (billing.ts), so the comp works without it.
  await db.update(schema.stores).set({ currentPeriodEnd: until }).where(eq(schema.stores.id, storeId));
  // `status` is DERIVED, never asserted — a comp does not unlock a store an operator suspended.
  const state = await syncStoredStatus(storeId);
  await logStore(
    storeId,
    state?.operatorSuspended
      ? `Gratis ${months} bulan diberikan (langganan s/d ${until.toLocaleDateString("id-ID")}). Hasil: toko TETAP ditangguhkan oleh platform — cabut penangguhan untuk membukanya.`
      : `Gratis ${months} bulan diberikan (aktif s/d ${until.toLocaleDateString("id-ID")})`,
  );
  revalidatePath(`/toko/${storeId}`); revalidatePath("/toko"); revalidatePath("/");
  return { ok: true, until: until.toISOString() };
}

// Extend / reset the free trial by N days from now.
export async function extendTrial(storeId: string, days = 7): Promise<{ ok: boolean; error?: string }> {
  const gate = await platformGate();
  if (!gate.ok) return gate;
  // ⚠️ A PAYING STORE IS NOT PUT BACK ON TRIAL. This used to write `currentPeriodEnd: null,
  // firstInvoicePaid: false` unconditionally, so "extend trial" on a store that had already paid
  // Rp305.250 threw away whatever was left of the month they bought AND re-armed both the Rp50rb promo
  // and the annual bonus month. Use "Gratiskan N bulan" for a paying store — that is what it is for.
  const [s] = await db
    .select({ currentPeriodEnd: schema.stores.currentPeriodEnd, firstInvoicePaid: schema.stores.firstInvoicePaid })
    .from(schema.stores)
    .where(eq(schema.stores.id, storeId))
    .limit(1);
  if (!s) return { ok: false, error: "Toko tidak ditemukan." };
  const hasPaidPeriod = !!s.currentPeriodEnd && s.currentPeriodEnd > new Date();
  if (hasPaidPeriod || s.firstInvoicePaid) {
    return { ok: false, error: "Toko ini sudah berlangganan — pakai \"Gratiskan 1 bulan\" agar periode berbayarnya tidak hangus." };
  }
  const until = new Date(Date.now() + days * 86_400_000);
  await db.update(schema.stores).set({ trialEndsAt: until, currentPeriodEnd: null, firstInvoicePaid: false }).where(eq(schema.stores.id, storeId));
  const state = await syncStoredStatus(storeId);
  await logStore(
    storeId,
    state?.operatorSuspended
      ? `Trial diperpanjang ${days} hari (s/d ${until.toLocaleDateString("id-ID")}). Hasil: toko TETAP ditangguhkan oleh platform.`
      : `Trial diperpanjang ${days} hari (s/d ${until.toLocaleDateString("id-ID")})`,
  );
  revalidatePath(`/toko/${storeId}`); revalidatePath("/toko"); revalidatePath("/");
  return { ok: true };
}

// VIP bypass: comped=true → no monthly charge (the "hapus langganan" one-door control).
export async function setStoreComped(storeId: string, comped: boolean, reason?: string): Promise<{ ok: boolean; error?: string }> {
  const gate = await platformGate();
  if (!gate.ok) return gate;
  const patch: Record<string, unknown> = { comped, compedReason: comped ? (reason?.trim() || "Dibebaskan platform") : null, compedAt: comped ? new Date() : null };
  // An unknown store id used to fall through: 0 rows updated, then `logStore` hit the
  // `platform_activity.store_id` FK and threw `23503` out of the action as a Next digest (page-map
  // sweep SA-2). Same shape as `suspendStore`/`liftSuspension`: report what was WRITTEN.
  const updated = await db.update(schema.stores).set(patch).where(eq(schema.stores.id, storeId)).returning({ id: schema.stores.id });
  if (!updated.length) return { ok: false, error: "Toko tidak ditemukan." };
  // VIP is always active — for BILLING. It is not an abuse shield: an operator suspension outranks
  // it (see `computeBilling`), so the stored status is derived rather than asserted `active` here.
  const state = await syncStoredStatus(storeId);
  const suffix = state?.operatorSuspended ? " Hasil: toko TETAP ditangguhkan oleh platform (VIP hanya membebaskan biaya, bukan penangguhan)." : "";
  await logStore(storeId, (comped ? `Langganan dibebaskan (VIP) — ${reason?.trim() || "tanpa biaya bulanan"}` : "Status VIP dicabut — kembali ke langganan berbayar") + suffix);
  revalidatePath(`/toko/${storeId}`); revalidatePath("/toko"); revalidatePath("/");
  return { ok: true };
}

// Reset the OWNER's password → returns a one-time temp password to hand over (scrypt-hashed at rest).
// Resetting a merchant's password hands over their account. Owner only.
export async function resetOwnerPassword(storeId: string): Promise<{ ok: boolean; password?: string; email?: string; error?: string }> {
  const gate = await platformGate("owner");
  if (!gate.ok) return gate;
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

// Reset a store user's password — scoped to THAT store, and owner-rank if the target is an owner.
//
// ⚠️ THIS WAS A FULL MERCHANT-ACCOUNT TAKEOVER, and it made the owner gate above decorative.
// It ran at the DEFAULT `admin` rank and looked the target up by `userId` ALONE — no join to
// `store_users`, no `storeId` filter — so a rank-2 operator could reset the password of ANY user row
// on the platform, including any store's OWNER, and `resetOwnerPassword`'s `requirePlatformAdmin("owner")`
// was simply routed around. The store-detail UI even renders the reset button on the owner's row
// (only DELETE is hidden for `role === "owner"`). `storeId` was used for nothing but the log line, so
// the audit trail could be pointed at a store the victim does not belong to.
//
// Two gates now, both necessary:
//   1. membership — the target must be a member of THIS store, read back through `store_users`.
//   2. rank — resetting an OWNER needs `owner`, exactly like `resetOwnerPassword`. Handing over a
//      merchant's account is the same act whichever button reaches it.
export async function resetStoreUserPassword(storeId: string, userId: string): Promise<{ ok: boolean; password?: string; email?: string; error?: string }> {
  const gate = await platformGate();
  if (!gate.ok) return gate;
  const [target] = await db
    .select({ email: schema.users.email, role: schema.storeUsers.role })
    .from(schema.storeUsers)
    .innerJoin(schema.users, eq(schema.users.id, schema.storeUsers.userId))
    .where(and(eq(schema.storeUsers.storeId, storeId), eq(schema.storeUsers.userId, userId)))
    .limit(1);
  if (!target) return { ok: false, error: "User tidak ditemukan di toko ini." };
  if (target.role === "owner") {
    const ownerGate = await platformGate("owner");
    if (!ownerGate.ok) return ownerGate;
  }
  const pw = tempPassword();
  await db.update(schema.users).set({ passwordHash: hashPassword(pw) }).where(eq(schema.users.id, userId));
  await logStore(storeId, `Password ${target.email} (${target.role}) direset oleh platform`);
  return { ok: true, password: pw, email: target.email };
}

export async function setStoreUserRole(storeId: string, storeUserId: string, role: "owner" | "admin" | "staff" | "gudang" | "advertiser" | "cs"): Promise<{ ok: boolean; error?: string }> {
  const gate = await platformGate();
  if (!gate.ok) return gate;
  // ⚠️ AN AUDIT LINE FOR A PRIVILEGE CHANGE THAT MAY NOT HAVE HAPPENED IS WORSE THAN NO AUDIT LINE.
  // This wrote blind and then logged "Peran … diubah → role oleh platform" unconditionally, so a
  // membership already removed in another tab left a permanent record of a promotion that never
  // occurred — in the one log an operator would consult to answer "who granted this?".
  const rows = await db
    .update(schema.storeUsers)
    .set({ role })
    .where(and(eq(schema.storeUsers.id, storeUserId), eq(schema.storeUsers.storeId, storeId)))
    .returning({ id: schema.storeUsers.id });
  if (!rows.length) return { ok: false, error: "Pengguna toko tidak ditemukan." };
  // A role change is a privilege change — promoting a user to `owner` grants them owner-only powers.
  // Log it (with the user's email) exactly like add/remove/reset already do.
  const [su] = await db
    .select({ email: schema.users.email })
    .from(schema.storeUsers)
    .innerJoin(schema.users, eq(schema.users.id, schema.storeUsers.userId))
    .where(eq(schema.storeUsers.id, storeUserId))
    .limit(1);
  await logStore(storeId, `Peran ${su?.email ?? "user"} diubah → ${role} oleh platform`);
  revalidatePath(`/toko/${storeId}`);
  return { ok: true };
}

export async function removeStoreUser(storeId: string, storeUserId: string): Promise<{ ok: boolean; error?: string }> {
  const gate = await platformGate();
  if (!gate.ok) return gate;
  // ⚠️ SAME CLASS AS `setStoreUserRole` ABOVE, AND IT WAS LEFT BEHIND (page-map sweep SA-1). The
  // pre-read had no `storeId` filter, the delete did, and the audit line was written regardless of
  // rows affected — so a `storeUserId` from ANOTHER store deleted 0 rows, returned `{ ok: true }`,
  // and wrote "User <the other store's email> dihapus dari toko" into THIS store's log. The
  // membership is read in THIS store only, the delete `.returning()`s, and nothing is logged for
  // a delete that did not happen.
  const [su] = await db.select({ role: schema.storeUsers.role, email: schema.users.email })
    .from(schema.storeUsers).innerJoin(schema.users, eq(schema.users.id, schema.storeUsers.userId))
    .where(and(eq(schema.storeUsers.id, storeUserId), eq(schema.storeUsers.storeId, storeId))).limit(1);
  if (!su) return { ok: false, error: "Pengguna toko tidak ditemukan." };
  if (su.role === "owner") return { ok: false, error: "Owner tidak bisa dihapus." };
  const removed = await db
    .delete(schema.storeUsers)
    .where(and(eq(schema.storeUsers.id, storeUserId), eq(schema.storeUsers.storeId, storeId)))
    .returning({ id: schema.storeUsers.id });
  if (!removed.length) return { ok: false, error: "Pengguna toko tidak ditemukan." };
  await logStore(storeId, `User ${su.email} dihapus dari toko oleh platform`);
  revalidatePath(`/toko/${storeId}`);
  return { ok: true };
}

/**
 * Add a user to a store. TWO outcomes, and they are not the same event:
 *
 *   `created` — the email was new here, so a `users` row was written WITH a fresh password hash.
 *               That password is the only copy in existence; the operator hands it over once.
 *   `linked`  — the email already belonged to someone on this platform (a merchant who staffs two
 *               shops, a returning owner). We add the MEMBERSHIP and touch nothing else.
 *
 * 🔴 IT REPORTED `created` FOR BOTH. `const pw = tempPassword()` was minted unconditionally, the
 * hash was written only inside `if (!u)`, and the return handed `pw` back either way — so linking an
 * existing person produced a "here is their new password" credential dialog for a string that had
 * never been hashed into any row and could not log anybody in. The operator then reads it out to the
 * merchant, the merchant tries it, it fails, and neither of them can tell why: the password is
 * well-formed, the account exists, and every screen said the operation succeeded.
 *
 * ⚠️ AND THE FIX IS **NOT** TO REHASH. Silently resetting an existing person's password because
 * someone added them to a second store would lock them out of the first one — a worse bug, and one
 * with no message anywhere either. `password: null` plus a caller that says what actually happened
 * is the honest shape. `outcome` is returned as its own field rather than left to be inferred from
 * `password == null`, because "no password" and "no password was NEEDED" read identically at a call
 * site and only one of them is good news.
 */
export async function addStoreUser(storeId: string, input: { name: string; email: string; role: "admin" | "staff" | "gudang" | "advertiser" | "cs" }): Promise<{ ok: boolean; password?: string | null; outcome?: "created" | "linked"; error?: string }> {
  const gate = await platformGate();
  if (!gate.ok) return gate;
  const email = input.email?.trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "Email tidak valid." };
  let [u] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email)).limit(1);
  // Minted INSIDE the branch that writes it, so the returned credential and the stored hash cannot
  // drift apart again — there is no `pw` in scope on the path that writes no hash.
  let minted: string | null = null;
  if (!u) {
    const pw = tempPassword();
    [u] = await db.insert(schema.users).values({ email, name: input.name?.trim() || email, passwordHash: hashPassword(pw) }).returning({ id: schema.users.id });
    minted = pw;
  }
  const [dup] = await db.select({ id: schema.storeUsers.id }).from(schema.storeUsers).where(and(eq(schema.storeUsers.storeId, storeId), eq(schema.storeUsers.userId, u.id))).limit(1);
  if (dup) return { ok: false, error: "User sudah ada di toko ini." };
  // 🔴 NO `acceptedAt` HERE. It used to write `new Date()`, which asserts that this person accepted
  // an invitation at the instant an OPERATOR pressed a button in the control plane — a fact nobody
  // observed. `accepted_at` is stamped once, on the merchant side, by the first successful sign-in;
  // until then NULL is the truth and reads as "belum pernah masuk".
  // ⚠️ The store's OWN OWNER row (`createStore`, `provision.ts`) is a different case and correctly
  // keeps its stamp: that account is created, not invited. Judge each site; do not sweep.
  await db.insert(schema.storeUsers).values({ storeId, userId: u.id, role: input.role });
  // The audit line says which of the two happened too — "ditambahkan" alone cannot be reviewed later
  // to answer "was this person given a credential?".
  const how = minted ? "akun baru dibuat" : "akun yang sudah ada dihubungkan";
  await logStore(storeId, `User ${email} (${input.role}) ditambahkan oleh platform — ${how}`);
  revalidatePath(`/toko/${storeId}`);
  return { ok: true, password: minted, outcome: minted ? "created" : "linked" };
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
  const gate = await platformGate();
  if (!gate.ok) return gate;
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
 *
 * 🔴 THE SOURCE STATE IS ENFORCED IN THE UPDATE'S OWN WHERE, NOT BY A READ ABOVE IT (Task 5.10 /
 * F-M15). This used to read the row, refuse `selesai` and `gagal`, and update whatever was left —
 * so `menunggu → selesai` passed: a payout **no operator had started transferring** was stamped
 * LUNAS, the merchant was told on `/saldo` that their money had been sent, and `processPayout`
 * could never run again because the status was no longer `menunggu`. The decision now lives in
 * `markPayoutPaidInTxn` (`payout-transition.ts`), where it can be driven against real Postgres for
 * every source status; this function stays what it should be — the gate, the audit line and the
 * revalidate. Do NOT re-add a status check or a status write here: two writers is two rules.
 */
export async function markPayoutPaid(payoutId: string, ref?: string): Promise<{ ok: boolean; error?: string; conflict?: PayoutConflict }> {
  const gate = await platformGate();
  if (!gate.ok) return gate;
  // Optional bank-transfer reference — trimmed, empty = none (NULL keeps the column untouched).
  const reference = ref?.trim() || null;
  const r = await db.transaction(async (tx) => markPayoutPaidInTxn(tx, payoutId, reference));
  // A refusal wrote nothing, so there is nothing to log and nothing to revalidate. `conflict` rides
  // along because "already lunas" and "never processed" are different facts to a caller; the toast
  // still prints `error`.
  if (!r.ok) return { ok: false, error: r.error, conflict: r.conflict };
  await logStore(
    r.storeId,
    `Pencairan ${rupiah(r.amount)} ditandai LUNAS — dana sudah ditransfer${reference ? ` (ref: ${reference})` : ""}`,
  );
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
  const gate = await platformGate();
  if (!gate.ok) return gate;
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
// Global subscription-PPN toggle (owner ruling 2026-08-24): OFF at launch so every tenant pays the
// flat DPP; flipping it ON makes the NEXT invoice of every store — new or existing — bill base+PPN 11%.
// It never rewrites an issued invoice: the three creators (billing cron, merchant pay flow, manual
// invoice) each read platform_finance at creation time, and the faktur renders the STORED taxIdr.
export async function setSubscriptionPpn(enabled: boolean): Promise<{ ok: boolean; error?: string }> {
  const gate = await platformGate();
  if (!gate.ok) return gate;
  const on = enabled === true; // never trust a truthy object over the wire
  // Single-row table (id=1 CHECK, seeded by migration 0101) — upsert rather than assume, same as platform_payout.
  const [existing] = await db.select({ id: schema.platformFinance.id }).from(schema.platformFinance).where(eq(schema.platformFinance.id, 1)).limit(1);
  if (existing) {
    await db.update(schema.platformFinance).set({ subscriptionPpnEnabled: on }).where(eq(schema.platformFinance.id, 1));
  } else {
    await db.insert(schema.platformFinance).values({ id: 1, subscriptionPpnEnabled: on });
  }
  await logPlatform(
    `PPN 11% langganan ${on ? "DIAKTIFKAN" : "DINONAKTIFKAN"} oleh ${gate.admin.email} — berlaku untuk tagihan berikutnya semua toko (tagihan terbit tidak berubah)`,
  );
  revalidatePath("/pengaturan");
  return { ok: true };
}

export async function savePayoutPolicy(input: { releaseOn: "selesai" | "dikirim"; minPayoutIdr: number }): Promise<{ ok: boolean; error?: string }> {
  const gate = await platformGate();
  if (!gate.ok) return gate;
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
