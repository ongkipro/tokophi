import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "./client";
import { storeMengantarAccounts, storeSettings, storeUsers, stores, users } from "./schema";
import { decryptSecret, encryptSecret, encryptionAvailable } from "@tokophi/lib/crypto";
import { uniqueViolationConstraint } from "@tokophi/lib/pg-errors";
import {
  getProviderConfig,
  maskKey,
  MENGANTAR_ORIGINS,
  type MengantarConfig,
  type MengantarPartnerConfig,
  type ProviderEnv,
} from "@tokophi/lib/provider-config";
import {
  MengantarPartnerConfigError,
  mengantarExternalUserId,
  partnerGetSellerKey,
  partnerListSellers,
  partnerPhone,
  partnerRegenerateSellerKey,
  partnerRegisterSeller,
  type PartnerCallOptions,
  type PartnerFailure,
} from "@tokophi/lib/mengantar-partner";

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Mengantar PARTNER model — one Mengantar SELLER account per store (owner 2026-11-05, decisions D7+
// in specs/docs/tasks/2026-11-05-shipping-mengantar-decisions.md). This module is the ONLY reader of
// a store's sealed seller key and the ONLY writer of `store_mengantar_accounts`' credential columns.
//
// WHAT IT HOLDS
//   · `openStoreMengantar` — THE opener. Every shipment call (quote, booking, cancel, pay, tracking,
//     operator reconcile) gets its `cfg` from here. Fails CLOSED: no row / not connected / undecryptable
//     / another env / another seller than the order names → no cfg, and the caller falls back or refuses.
//   · `connectStoreMengantar` — registration through the Partner API with the store OWNER's TokoΦ email
//     (O7: never a pasted key). Exactly-once by a compare-and-swap claim on `state`; a register whose
//     answer is lost is reconciled via `sellers/list {externalUserId}` before anything else; the seller id
//     is written only after that list PROVED it belongs to this store (GeraiExpress P0-1 — every store
//     shares ONE partner, so "the provider returned a seller" is not proof it is ours).
//   · `rotateStoreMengantarKey` — fence (`connected → rotating`), regenerate ONCE, seal under a NEW key
//     version. A lost regenerate answer is recovered with `sellers/api-key`, never a second regenerate.
//   · `enqueueMengantarConnect` / `retryMengantarAccounts` — provisioning never waits on, or fails
//     because of, Mengantar (O10): the row is queued `pending` and the cron retries it.
//
// POOL: owner `db`, with an EXPLICIT `store_id` filter on every statement (AGENTS.md: the WHERE is the
// rule, RLS is the net). Callers are the public routes, the cron, provisioning and Super Admin — none
// has a tenant GUC — and Seller actions, which pass their already-authorised `storeId`.
//
// NEVER print a key: callers get `maskKey()` (`key_hint`) and nothing else.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

export type MgAccountState = "pending" | "registering" | "connected" | "email_taken" | "failed" | "blocked" | "rotating";

/** GCM scope of a seller key: bound to the store, env, seller AND key version — a blob replayed into another row, env, seller or version does not decrypt. */
export const mengantarKeyScope = (storeId: string, env: ProviderEnv, sellerId: string, version: number) => `mengantar:${storeId}:${env}:${sellerId}:v${version}`;

/** How long a `registering`/`rotating` claim is considered in flight before the retry sweep may take it. */
export const MG_CLAIM_STALE_MS = 2 * 60 * 1000;

const activeEnv = async (): Promise<ProviderEnv> => (await getProviderConfig()).mengantar.env;

// ─── The opener ──────────────────────────────────────────────────────────────────────────────────

export type MgOpenFailure = "not_connected" | "rotating" | "key_unreadable" | "env_mismatch" | "seller_mismatch";
export type MgOpen = { ok: true; cfg: MengantarConfig; sellerId: string; env: ProviderEnv; pickupAddressId: string | null } | { ok: false; reason: MgOpenFailure };

/**
 * The store's seller config for the CURRENT `MENGANTAR_ENV`. Pass `order` (its `mg_env` / `mg_seller_id`)
 * when acting on an existing shipment: a shipment booked in another env, or by a seller account the store
 * no longer holds, is REFUSED rather than handed to a key that never booked it.
 */
export async function openStoreMengantar(storeId: string, order?: { mgEnv?: string | null; mgSellerId?: string | null }): Promise<MgOpen> {
  const env = await activeEnv();
  if (order?.mgEnv && order.mgEnv !== env) return { ok: false, reason: "env_mismatch" };
  const [row] = await db
    .select({ state: storeMengantarAccounts.state, sellerId: storeMengantarAccounts.sellerId, enc: storeMengantarAccounts.apiKeyEnc, v: storeMengantarAccounts.keyVersion, pickup: storeMengantarAccounts.pickupAddressId })
    .from(storeMengantarAccounts)
    .where(and(eq(storeMengantarAccounts.storeId, storeId), eq(storeMengantarAccounts.env, env)))
    .limit(1);
  if (!row) return { ok: false, reason: "not_connected" };
  if (row.state === "rotating") return { ok: false, reason: "rotating" };
  if (row.state !== "connected" || !row.sellerId || !row.enc) return { ok: false, reason: "not_connected" };
  if (order?.mgSellerId && order.mgSellerId !== row.sellerId) return { ok: false, reason: "seller_mismatch" };
  const key = decryptSecret(row.enc, mengantarKeyScope(storeId, env, row.sellerId, row.v));
  if (!key) return { ok: false, reason: "key_unreadable" };
  return { ok: true, cfg: { env, base: MENGANTAR_ORIGINS[env].public, key }, sellerId: row.sellerId, env, pickupAddressId: row.pickup };
}

/** Seller-facing sentence for an opener refusal (brand allowed on the Seller surface, owner O5). */
export function openFailureMessage(reason: MgOpenFailure): string {
  switch (reason) {
    case "rotating":
      return "Kunci akun Mengantar toko sedang diperbarui. Coba lagi sebentar.";
    case "key_unreadable":
      return "Kunci akun Mengantar toko tidak terbaca. Hubungkan ulang di Pengaturan → Pengiriman.";
    case "env_mismatch":
      return "Pengiriman ini dibuat di lingkungan Mengantar lain dan tidak bisa diproses dari sini.";
    case "seller_mismatch":
      return "Pengiriman ini dibuat dengan akun Mengantar toko yang lama. Hubungi dukungan TokoΦ.";
    default:
      return "Akun Mengantar toko belum terhubung atau sedang tidak aktif, jadi pengiriman ini belum bisa diproses. Hubungkan di Pengaturan → Pengiriman; kalau tombolnya tidak membantu, hubungi dukungan TokoΦ.";
  }
}

/** The sender fields a pickup address was registered FROM (what `POST /address` was sent). */
export type PickupSnapshot = {
  senderName: string | null;
  senderPhone: string | null;
  senderAddress: string | null;
  senderKelurahanName: string | null;
  senderPostcode: string | null;
  senderMengantarAreaId: string | null;
};

/**
 * Remember the pickup address registered IN THIS seller account (compare-and-set: the first id wins).
 * `from` = the sender fields it was registered from: the id is stored only while `store_settings` STILL
 * holds them. A seller who saved a new address while this registration was in flight cleared the slot;
 * without this check the stale registration would refill it and every later pickup would go to the
 * old door. Lost → null → the caller says "coba lagi", and the next booking registers the new address.
 */
export async function storePickupAddressId(storeId: string, sellerId: string, addressId: string, from: PickupSnapshot): Promise<string | null> {
  const env = await activeEnv();
  const ss = storeSettings;
  const won = await db
    .update(storeMengantarAccounts)
    .set({ pickupAddressId: addressId, updatedAt: new Date() })
    .where(
      and(
        eq(storeMengantarAccounts.storeId, storeId),
        eq(storeMengantarAccounts.env, env),
        eq(storeMengantarAccounts.sellerId, sellerId),
        sql`${storeMengantarAccounts.pickupAddressId} is null`,
        sql`exists (select 1 from ${ss} where ${ss.storeId} = ${storeId}
              and ${ss.senderName} is not distinct from ${from.senderName}
              and ${ss.senderPhone} is not distinct from ${from.senderPhone}
              and ${ss.senderAddress} is not distinct from ${from.senderAddress}
              and ${ss.senderKelurahanName} is not distinct from ${from.senderKelurahanName}
              and ${ss.senderPostcode} is not distinct from ${from.senderPostcode}
              and ${ss.senderMengantarAreaId} is not distinct from ${from.senderMengantarAreaId})`,
      ),
    )
    .returning({ id: storeMengantarAccounts.pickupAddressId });
  if (won[0]?.id) return won[0].id;
  const [cur] = await db
    .select({ id: storeMengantarAccounts.pickupAddressId })
    .from(storeMengantarAccounts)
    .where(and(eq(storeMengantarAccounts.storeId, storeId), eq(storeMengantarAccounts.env, env), eq(storeMengantarAccounts.sellerId, sellerId)))
    .limit(1);
  return cur?.id ?? null;
}

/** The sender address changed → the next booking registers it again (every env: the old door is wrong everywhere). */
export async function clearPickupAddress(storeId: string): Promise<void> {
  await db.update(storeMengantarAccounts).set({ pickupAddressId: null, updatedAt: new Date() }).where(eq(storeMengantarAccounts.storeId, storeId));
}

// ─── Status (Seller Pengaturan + Super Admin) ───────────────────────────────────────────────────

export type MgAccountStatus = {
  env: ProviderEnv;
  state: MgAccountState | "none";
  sellerId: string | null;
  partnerId: string | null;
  keyHint: string;
  ownerEmail: string | null;
  lastErrorCode: string | null;
  lastError: string | null;
  retryAfterAt: Date | null;
  connectedAt: Date | null;
  updatedAt: Date | null;
};

export async function mengantarAccountStatus(storeId: string): Promise<MgAccountStatus> {
  const env = await activeEnv();
  const [r] = await db.select().from(storeMengantarAccounts).where(and(eq(storeMengantarAccounts.storeId, storeId), eq(storeMengantarAccounts.env, env))).limit(1);
  if (!r) return { env, state: "none", sellerId: null, partnerId: null, keyHint: "—", ownerEmail: null, lastErrorCode: null, lastError: null, retryAfterAt: null, connectedAt: null, updatedAt: null };
  return {
    env,
    state: r.state as MgAccountState,
    sellerId: r.sellerId,
    partnerId: r.partnerId,
    keyHint: r.keyHint ? `…${r.keyHint}` : "—",
    ownerEmail: r.ownerEmail,
    lastErrorCode: r.lastErrorCode,
    lastError: r.lastError,
    retryAfterAt: r.retryAfterAt,
    connectedAt: r.connectedAt,
    updatedAt: r.updatedAt,
  };
}

// ─── Registration ────────────────────────────────────────────────────────────────────────────────

export type ConnectSource = "signup" | "pengaturan" | "operator" | "cron";
export type ConnectOptions = {
  source: ConnectSource;
  /** The user who triggered it (consent_by) — the owner on signup / Pengaturan, null for cron. */
  actorUserId?: string | null;
  /** Injected for tests / the sandbox e2e: partner config + fetch. Default: the resolved active config. */
  partner?: Partial<PartnerCallOptions>;
  now?: () => number;
};
export type ConnectResult = { state: MgAccountState | "none"; message: string };

async function partnerOpts(o: ConnectOptions): Promise<PartnerCallOptions> {
  const cfg: MengantarPartnerConfig = o.partner?.cfg ?? (await getProviderConfig()).mengantar;
  return { ...o.partner, cfg };
}

/** The store owner's identity, read LIVE so a fixed phone fixes the next retry. */
async function ownerIdentity(storeId: string) {
  const [o] = await db
    .select({ email: users.email, name: users.name, userId: users.id, storeName: stores.name, storePhone: stores.phone, senderPhone: storeSettings.senderPhone })
    .from(storeUsers)
    .innerJoin(users, eq(users.id, storeUsers.userId))
    .innerJoin(stores, eq(stores.id, storeUsers.storeId))
    .leftJoin(storeSettings, eq(storeSettings.storeId, storeUsers.storeId))
    .where(and(eq(storeUsers.storeId, storeId), eq(storeUsers.role, "owner")))
    .orderBy(storeUsers.acceptedAt)
    .limit(1);
  if (!o) return null;
  return {
    email: o.email.trim().toLowerCase(),
    // Mengantar's name rule: letters, digits, space and ' - _ . @ — the store name is the account's face.
    name: (o.storeName || o.name || "Toko").replace(/[^\p{L}\p{N} '\-_.@]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 100) || "Toko",
    phone: o.senderPhone?.trim() || o.storePhone?.trim() || null,
    userId: o.userId,
  };
}

async function ensureRow(storeId: string, env: ProviderEnv, o: ConnectOptions): Promise<void> {
  await db
    .insert(storeMengantarAccounts)
    .values({
      storeId,
      env,
      externalUserId: mengantarExternalUserId(storeId, env),
      state: "pending",
      consentSource: o.source,
      consentBy: o.actorUserId ?? null,
      consentedAt: o.actorUserId ? new Date() : null,
    })
    .onConflictDoNothing();
}

const where = (storeId: string, env: ProviderEnv) => and(eq(storeMengantarAccounts.storeId, storeId), eq(storeMengantarAccounts.env, env));

async function setState(storeId: string, env: ProviderEnv, from: MgAccountState[], patch: Partial<typeof storeMengantarAccounts.$inferInsert>) {
  return db
    .update(storeMengantarAccounts)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(where(storeId, env), inArray(storeMengantarAccounts.state, from)))
    .returning({ state: storeMengantarAccounts.state });
}

/** Next 00:00 WIB — when DAILY_REGISTRATION_LIMIT resets. */
function nextWibMidnight(now: number): Date {
  const wib = new Date(now + 7 * 3600_000);
  wib.setUTCHours(24, 0, 0, 0);
  return new Date(wib.getTime() - 7 * 3600_000);
}

const SELLER_MSG: Record<string, string> = {
  connected: "Akun Mengantar toko terhubung.",
  email_taken: "Email pemilik toko sudah terdaftar sebagai akun Mengantar, jadi TokoΦ tidak bisa membuatkan akun baru. Toko tetap memakai pengiriman standar TokoΦ.",
  pending: "Pendaftaran akun Mengantar dijadwalkan ulang otomatis. Toko tetap memakai pengiriman standar TokoΦ sementara itu.",
  registering: "Pendaftaran akun Mengantar sedang diproses.",
  failed: "Pendaftaran akun Mengantar ditolak. Periksa data di bawah lalu coba lagi.",
  blocked: "Akun Mengantar toko dinonaktifkan Mengantar. Hubungi dukungan TokoΦ.",
};

/** Map a definite Partner refusal to the row's next state. `unknown` failures never reach here. */
function refusalPatch(f: PartnerFailure, now: number): { state: MgAccountState; patch: Partial<typeof storeMengantarAccounts.$inferInsert> } {
  const base = { lastErrorCode: f.code, lastError: f.message.slice(0, 300) };
  switch (f.code) {
    case "EMAIL_ALREADY_REGISTERED":
      return { state: "email_taken", patch: { ...base, state: "email_taken", retryAfterAt: null } };
    case "RATE_LIMITED":
      return { state: "pending", patch: { ...base, state: "pending", retryAfterAt: new Date(now + (f.retryAfterSec ?? 60) * 1000) } };
    case "DAILY_REGISTRATION_LIMIT":
      return { state: "pending", patch: { ...base, state: "pending", retryAfterAt: f.retryAfterSec != null ? new Date(now + f.retryAfterSec * 1000) : nextWibMidnight(now) } };
    case "KEY_PROVISIONING_FAILED":
      return { state: "pending", patch: { ...base, state: "pending", retryAfterAt: new Date(now + 60_000) } };
    case "SELLER_DEACTIVATED":
    case "API_KEY_DISABLED":
      return { state: "blocked", patch: { ...base, state: "blocked" } };
    case "MISSING_FIELDS":
    case "INVALID_NAME":
    case "INVALID_EMAIL":
    case "INVALID_PHONE":
    case "PHONE_NOT_ALLOWED":
      return { state: "failed", patch: { ...base, state: "failed" } };
    default:
      // Partner-level (UNAUTHORIZED, IP_NOT_ALLOWED, PARTNER_DEACTIVATED, INVALID_TIMESTAMP, unexpected
      // codes): not this store's fault and fixable by ops — retried later, never a lock-out (O10).
      return { state: "pending", patch: { ...base, state: "pending", retryAfterAt: new Date(now + 30 * 60_000) } };
  }
}

/**
 * Connect ONE store to its own Mengantar seller account. Never throws (provisioning calls it); every
 * outcome is a row state + a seller-facing sentence. See the header for the rules.
 */
export async function connectStoreMengantar(storeId: string, o: ConnectOptions): Promise<ConnectResult> {
  const now = o.now ?? Date.now;
  let env: ProviderEnv = "sandbox";
  try {
    const popts = await partnerOpts(o);
    env = popts.cfg.env;
    await ensureRow(storeId, env, o);
    if (o.actorUserId) {
      // An owner who clicks (or signs up) records the consent; a cron retry never overwrites it.
      await db.update(storeMengantarAccounts).set({ consentSource: o.source, consentBy: o.actorUserId, consentedAt: new Date() }).where(where(storeId, env));
    }

    // Configuration first — no network: a missing origin or credential queues the store, never locks it.
    // An UNSET MENGANTAR_ENV reads as sandbox: registering a real seller's email and phone on the
    // SANDBOX partner (say, after sandbox credentials were saved on production) would hand their
    // identity to an account that ships nothing. Registration needs the env NAMED, like the switch
    // and the quote dispatch.
    if (popts.cfg.envSource !== "env" || !popts.cfg.partnerBase || !popts.cfg.partnerId || !popts.cfg.partnerSecret || !encryptionAvailable()) {
      const why = popts.cfg.envSource !== "env"
        ? "MENGANTAR_ENV belum diset di server — pendaftaran akun Mengantar ditahan."
        : !popts.cfg.partnerBase
        ? `Origin Partner API Mengantar (${env}) belum diketahui.`
        : !encryptionAvailable()
          ? "INTEGRATION_TOKEN_KEY belum diset — kunci tidak bisa disimpan terenkripsi."
          : `Kredensial Partner Mengantar (${env}) belum dikonfigurasi.`;
      await setState(storeId, env, ["pending", "registering"], { state: "pending", lastErrorCode: "configuration_blocked", lastError: why, retryAfterAt: new Date(now() + 15 * 60_000) });
      return { state: "pending", message: SELLER_MSG.pending };
    }

    // A self-serve store is born unapproved and nothing proved its email (0090). Mengantar holds the
    // partner responsible for the accounts it opens, so registration waits for the operator's approval
    // (`approveStore` re-triggers it). Queued, not failed.
    const [st] = await db.select({ approvedAt: stores.approvedAt }).from(stores).where(eq(stores.id, storeId)).limit(1);
    if (!st?.approvedAt) {
      await setState(storeId, env, ["pending", "registering"], { state: "pending", lastErrorCode: "awaiting_approval", lastError: "Menunggu persetujuan toko oleh TokoΦ.", retryAfterAt: new Date(now() + 60 * 60_000) });
      return { state: "pending", message: "Akun Mengantar dibuat otomatis setelah toko disetujui TokoΦ." };
    }

    const who = await ownerIdentity(storeId);
    if (!who) {
      await setState(storeId, env, ["pending", "registering"], { state: "failed", lastErrorCode: "owner_missing", lastError: "Toko belum punya pemilik." });
      return { state: "failed", message: "Toko belum punya pemilik — akun Mengantar tidak bisa dibuat." };
    }
    if (!partnerPhone(who.phone)) {
      await setState(storeId, env, ["pending", "registering"], {
        state: "failed",
        ownerEmail: who.email,
        ownerName: who.name,
        lastErrorCode: "INVALID_PHONE",
        lastError: "Nomor HP pengirim belum diisi atau bukan nomor seluler Indonesia.",
      });
      return { state: "failed", message: "Isi nomor HP pengirim (nomor seluler 08…) di Pengaturan → Alamat, lalu hubungkan Mengantar lagi." };
    }

    // THE CLAIM — exactly one caller registers at a time. A `registering` row older than the stale
    // window is a crashed or lost attempt and may be taken over (register is idempotent on the id).
    const stale = new Date(now() - MG_CLAIM_STALE_MS);
    const claimed = await db
      .update(storeMengantarAccounts)
      .set({ state: "registering", attempts: sql`${storeMengantarAccounts.attempts} + 1`, ownerEmail: who.email, ownerName: who.name, ownerPhone: partnerPhone(who.phone), updatedAt: new Date(now()) })
      .where(
        and(
          where(storeId, env),
          sql`((${storeMengantarAccounts.state} = 'pending' and (${storeMengantarAccounts.retryAfterAt} is null or ${storeMengantarAccounts.retryAfterAt} <= ${new Date(now()).toISOString()}::timestamptz))
            or (${storeMengantarAccounts.state} = 'registering' and ${storeMengantarAccounts.updatedAt} < ${stale.toISOString()}::timestamptz))`,
        ),
      )
      .returning({ sellerId: storeMengantarAccounts.sellerId, ext: storeMengantarAccounts.externalUserId, v: storeMengantarAccounts.keyVersion });
    if (!claimed.length) {
      const cur = await mengantarAccountStatus(storeId);
      return { state: cur.state, message: SELLER_MSG[cur.state] ?? SELLER_MSG.pending };
    }
    const { ext } = claimed[0];

    // 1. Register (idempotent on externalUserId). A lost answer is RECONCILED, never assumed.
    const reg = await partnerRegisterSeller({ name: who.name, email: who.email, phone: who.phone!, externalUserId: ext }, popts);
    let sellerId: string | null = null;
    let apiKey: string | null = null;
    if (reg.ok) {
      sellerId = reg.data.sellerId;
      apiKey = reg.data.apiKey;
    } else if (reg.unknown) {
      const found = await partnerListSellers({ externalUserId: ext }, popts);
      const mine = found.ok ? found.data.sellers.filter((s) => s.externalUserId === ext) : [];
      if (!found.ok || mine.length !== 1) {
        // Still unknown (or not created): stays `registering`; the retry sweep takes it after the stale
        // window and repeats the SAME register — safe by the provider's idempotency on this id.
        await setState(storeId, env, ["registering"], { lastErrorCode: "outcome_unknown", lastError: `Jawaban pendaftaran tidak terbaca (${reg.code}); dicek ulang otomatis.` });
        return { state: "registering", message: SELLER_MSG.registering };
      }
      sellerId = mine[0].sellerId;
    } else {
      // KEY_PROVISIONING_FAILED carries a sellerId; it is NOT written (unproven) — the retry re-registers
      // with the same externalUserId, which is exactly what the provider asks for.
      const next = refusalPatch(reg, now());
      await setState(storeId, env, ["registering"], next.patch);
      return { state: next.state, message: SELLER_MSG[next.state] ?? SELLER_MSG.pending };
    }

    // 2. OWNERSHIP PROOF: the seller id is ours only if `sellers/list` says this externalUserId owns it.
    const proof = await partnerListSellers({ externalUserId: ext }, popts);
    const owned = proof.ok ? proof.data.sellers.filter((s) => s.externalUserId === ext) : [];
    if (!proof.ok || owned.length !== 1 || owned[0].sellerId !== sellerId) {
      await setState(storeId, env, ["registering"], {
        state: "pending",
        lastErrorCode: "ownership_unproven",
        lastError: "Kepemilikan akun Mengantar belum terbukti; dicek ulang otomatis.",
        retryAfterAt: new Date(now() + 60_000),
      });
      return { state: "pending", message: SELLER_MSG.pending };
    }
    if (!owned[0].active) {
      await setState(storeId, env, ["registering"], { state: "blocked", lastErrorCode: "SELLER_DEACTIVATED", lastError: "Akun seller dinonaktifkan Mengantar." });
      return { state: "blocked", message: SELLER_MSG.blocked };
    }

    // 3. The key — from the register answer, else fetched for the PROVEN seller.
    if (!apiKey) {
      const k = await partnerGetSellerKey(sellerId!, popts);
      if (!k.ok) {
        const next = k.unknown ? { state: "registering" as const, patch: { lastErrorCode: "outcome_unknown", lastError: "Kunci belum terbaca; dicek ulang otomatis." } } : refusalPatch(k, now());
        await setState(storeId, env, ["registering"], next.patch);
        return { state: next.state, message: SELLER_MSG[next.state] ?? SELLER_MSG.pending };
      }
      apiKey = k.data.apiKey;
    }

    // 4. Seal + connect, in ONE statement guarded by the claim.
    return await seal(storeId, env, sellerId!, apiKey, claimed[0].v + 1, popts.cfg.partnerId!, ["registering"]);
  } catch (e) {
    // Never thrown into provisioning. A config error is already handled above; anything else queues.
    const msg = e instanceof MengantarPartnerConfigError ? e.message : e instanceof Error ? e.name : "UnknownError";
    console.error("[mengantar-account] connect failed", storeId, msg);
    try {
      await setState(storeId, env, ["registering", "pending"], { state: "pending", lastErrorCode: "internal", lastError: msg.slice(0, 300), retryAfterAt: new Date(now() + 5 * 60_000) });
    } catch {
      /* the DB itself may be what failed — the next retry reads the row as it is */
    }
    return { state: "pending", message: SELLER_MSG.pending };
  }
}

async function seal(storeId: string, env: ProviderEnv, sellerId: string, apiKey: string, version: number, partnerId: string, from: MgAccountState[]): Promise<ConnectResult> {
  const blob = encryptSecret(apiKey, mengantarKeyScope(storeId, env, sellerId, version));
  try {
    const done = await setState(storeId, env, from, {
      state: "connected",
      sellerId,
      partnerId,
      apiKeyEnc: blob,
      keyVersion: version,
      keyHint: apiKey.slice(-4),
      connectedAt: new Date(),
      lastErrorCode: null,
      lastError: null,
      retryAfterAt: null,
    });
    if (!done.length) return { state: "pending", message: SELLER_MSG.pending };
    return { state: "connected", message: `${SELLER_MSG.connected} (kunci ${maskKey(apiKey)})` };
  } catch (e) {
    // `sma_seller_uniq`: this seller id is already bound to ANOTHER store in this env. Never shared.
    if (uniqueViolationConstraint(e) !== null) {
      await setState(storeId, env, from, { state: "blocked", lastErrorCode: "seller_conflict", lastError: "Seller Mengantar ini sudah terikat ke toko lain." });
      return { state: "blocked", message: SELLER_MSG.blocked };
    }
    throw e;
  }
}

/**
 * Queue a store for connection and try once in the background (provisioning: signup + Super Admin
 * createStore). NEVER throws and never awaits the provider: store creation must not depend on
 * Mengantar being up (O10). A process that dies mid-attempt leaves `pending`/`registering`; the cron
 * sweep (`retryMengantarAccounts`) finishes it.
 */
export async function enqueueMengantarConnect(storeId: string, o: ConnectOptions): Promise<void> {
  try {
    const env = (o.partner?.cfg ?? (await getProviderConfig()).mengantar).env;
    await ensureRow(storeId, env, o);
  } catch (e) {
    console.error("[mengantar-account] enqueue failed (store creation continues)", storeId, e instanceof Error ? e.name : e);
    return;
  }
  void connectStoreMengantar(storeId, o).catch(() => {});
}

/** The Seller "Hubungkan" button reaches the partner API (1–3 calls per click) on a budget every store
 * shares (60/min, 1000 sellers/day). One owner clicking repeatedly must not spend it for everyone:
 *   · `blocked` (seller conflict, deactivated seller) is an OPERATOR's case — a click changes nothing;
 *   · otherwise one attempt per row per minute.
 * Pure, so the rule is testable; null = go ahead. Operator retries (Super Admin) are not gated here. */
export const SELLER_CONNECT_COOLDOWN_MS = 60_000;
export function sellerConnectRefusal(st: Pick<MgAccountStatus, "state" | "updatedAt">, now: number): string | null {
  if (st.state === "rotating") return "Kunci akun Mengantar toko sedang diperbarui. Coba lagi sebentar.";
  if (st.state === "blocked") return "Pendaftaran Mengantar toko ini perlu ditinjau tim TokoΦ. Hubungi dukungan TokoΦ — mencoba lagi dari sini tidak mengubah hasilnya.";
  if (st.state === "none" || !st.updatedAt) return null;
  const wait = SELLER_CONNECT_COOLDOWN_MS - (now - new Date(st.updatedAt).getTime());
  if (wait > 0) return `Percobaan terakhir baru saja dilakukan. Coba lagi dalam ${Math.ceil(wait / 1000)} detik.`;
  return null;
}

/** Put a terminal row back in the queue (owner clicked "Hubungkan" again, operator retry). */
export async function requeueMengantar(storeId: string, o: ConnectOptions): Promise<void> {
  const env = (o.partner?.cfg ?? (await getProviderConfig()).mengantar).env;
  await ensureRow(storeId, env, o);
  // A provider rate limit SURVIVES a click (GeraiExpress SEC-05): only other waits are cleared.
  await db
    .update(storeMengantarAccounts)
    .set({
      state: "pending",
      updatedAt: new Date(),
      retryAfterAt: sql`case when ${storeMengantarAccounts.lastErrorCode} in ('RATE_LIMITED', 'DAILY_REGISTRATION_LIMIT') then ${storeMengantarAccounts.retryAfterAt} else null end`,
    })
    .where(and(where(storeId, env), inArray(storeMengantarAccounts.state, ["failed", "email_taken", "blocked", "pending"])));
}

/** Requeue + one background attempt; never throws (Super Admin approval / createStore). */
export async function kickMengantarConnect(storeId: string, o: ConnectOptions): Promise<void> {
  try {
    await requeueMengantar(storeId, o);
  } catch (e) {
    console.error("[mengantar-account] requeue failed", storeId, e instanceof Error ? e.name : e);
    return;
  }
  void connectStoreMengantar(storeId, o).catch(() => {});
}

// ─── Rotation ────────────────────────────────────────────────────────────────────────────────────

export type RotateOptions = { partner?: Partial<PartnerCallOptions>; now?: () => number };

/**
 * Replace a connected store's seller key (store owner or Super Admin owner rank — the CALLER gates).
 * Fence → regenerate ONCE → seal v+1. The old key dies at the provider the moment regenerate succeeds,
 * and its blob is overwritten here, so no code path can open it again.
 */
export async function rotateStoreMengantarKey(storeId: string, o: RotateOptions = {}): Promise<ConnectResult> {
  const popts = await partnerOpts({ source: "operator", partner: o.partner });
  const env = popts.cfg.env;
  const fenced = await db
    .update(storeMengantarAccounts)
    .set({ state: "rotating", updatedAt: new Date() })
    .where(and(where(storeId, env), eq(storeMengantarAccounts.state, "connected"), sql`${storeMengantarAccounts.sellerId} is not null`))
    .returning({ sellerId: storeMengantarAccounts.sellerId, v: storeMengantarAccounts.keyVersion });
  if (!fenced.length) return { state: (await mengantarAccountStatus(storeId)).state, message: "Hanya akun Mengantar yang terhubung yang bisa diperbarui kuncinya." };
  const { sellerId, v } = fenced[0];
  let r;
  try {
    r = await partnerRegenerateSellerKey(sellerId!, popts);
  } catch (e) {
    // Config refusal: nothing was sent → the old key still works.
    await setState(storeId, env, ["rotating"], { state: "connected", lastErrorCode: "configuration_blocked", lastError: e instanceof Error ? e.message.slice(0, 300) : "config" });
    return { state: "connected", message: "Kunci tidak diperbarui: kredensial Partner Mengantar belum siap." };
  }
  if (r.ok) return seal(storeId, env, sellerId!, r.data.apiKey, v + 1, popts.cfg.partnerId!, ["rotating"]);
  if (!r.unknown) {
    const blocked = r.code === "SELLER_DEACTIVATED" || r.code === "API_KEY_DISABLED";
    await setState(storeId, env, ["rotating"], { state: blocked ? "blocked" : "connected", lastErrorCode: r.code, lastError: r.message.slice(0, 300) });
    return { state: blocked ? "blocked" : "connected", message: `Kunci tidak diperbarui: ${r.message}` };
  }
  // The regenerate MAY have happened (the old key may be dead). Recover the CURRENT key — never a second regenerate.
  return recoverRotation(storeId, env, sellerId!, v, popts);
}

async function recoverRotation(storeId: string, env: ProviderEnv, sellerId: string, v: number, popts: PartnerCallOptions): Promise<ConnectResult> {
  const k = await partnerGetSellerKey(sellerId, popts);
  if (k.ok) return seal(storeId, env, sellerId, k.data.apiKey, v + 1, popts.cfg.partnerId!, ["rotating"]);
  await setState(storeId, env, ["rotating"], { lastErrorCode: "rotation_unknown", lastError: `Hasil pembaruan kunci belum diketahui (${k.code}); dipulihkan otomatis.` });
  return { state: "rotating", message: "Pembaruan kunci belum terkonfirmasi; dipulihkan otomatis dalam beberapa menit." };
}

// ─── The retry sweep (cron) ──────────────────────────────────────────────────────────────────────

export type MgAccountSweep = { picked: number; connected: number; stillPending: number; recovered: number };

/**
 * Finish queued work, bounded per tick (the 60/min partner budget is shared with every product on the
 * partner): `pending` rows whose `retry_after_at` passed, `registering` rows stuck past the stale
 * window, and `rotating` rows stuck past it (recovered with `sellers/api-key`, never a regenerate).
 */
export async function retryMengantarAccounts(o: { limit?: number; partner?: Partial<PartnerCallOptions>; now?: () => number } = {}): Promise<MgAccountSweep> {
  const now = o.now ?? Date.now;
  const popts = await partnerOpts({ source: "cron", partner: o.partner });
  const env = popts.cfg.env;
  const stale = new Date(now() - MG_CLAIM_STALE_MS);
  const rows = await db
    .select({ storeId: storeMengantarAccounts.storeId, state: storeMengantarAccounts.state, sellerId: storeMengantarAccounts.sellerId, v: storeMengantarAccounts.keyVersion })
    .from(storeMengantarAccounts)
    .where(
      and(
        eq(storeMengantarAccounts.env, env),
        sql`((${storeMengantarAccounts.state} = 'pending' and (${storeMengantarAccounts.retryAfterAt} is null or ${storeMengantarAccounts.retryAfterAt} <= ${new Date(now()).toISOString()}::timestamptz))
          or (${storeMengantarAccounts.state} in ('registering', 'rotating') and ${storeMengantarAccounts.updatedAt} < ${stale.toISOString()}::timestamptz))`,
      ),
    )
    .orderBy(storeMengantarAccounts.updatedAt)
    .limit(o.limit ?? 5);
  const sum: MgAccountSweep = { picked: rows.length, connected: 0, stillPending: 0, recovered: 0 };
  for (const r of rows) {
    if (r.state === "rotating" && r.sellerId) {
      // Take the stale fence over first (a CAS on updated_at) so two sweeps cannot both recover.
      const took = await db
        .update(storeMengantarAccounts)
        .set({ updatedAt: new Date(now()) })
        .where(and(where(r.storeId, env), eq(storeMengantarAccounts.state, "rotating"), sql`${storeMengantarAccounts.updatedAt} < ${stale.toISOString()}::timestamptz`))
        .returning({ v: storeMengantarAccounts.keyVersion });
      if (!took.length) continue;
      const res = await recoverRotation(r.storeId, env, r.sellerId, took[0].v, popts);
      if (res.state === "connected") sum.recovered++;
      continue;
    }
    const res = await connectStoreMengantar(r.storeId, { source: "cron", partner: o.partner, now });
    if (res.state === "connected") sum.connected++;
    else sum.stillPending++;
  }
  return sum;
}
