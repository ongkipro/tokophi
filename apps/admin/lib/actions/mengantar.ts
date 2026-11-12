"use server";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import { getSession } from "@/lib/auth";
import {
  connectStoreMengantar,
  mengantarAccountStatus,
  requeueMengantar,
  sellerConnectRefusal,
  rotateStoreMengantarKey,
  type MgAccountStatus,
} from "@tokophi/db/mengantar-account";
import { mengantarStoreBalance, payMengantarUnpaid } from "@/lib/mengantar-shipping";
import { getProviderConfig } from "@tokophi/lib/provider-config";
import { schema } from "@tokophi/db";
import { withTenant } from "@/lib/tenant";
import { mengantarNotice, mengantarReadiness, type MengantarNotice, type MengantarReadiness } from "@/lib/mengantar-readiness";
import { can } from "@/lib/rbac-policy";

// Mengantar Partner Business API — the Seller's own actions. The store's Mengantar account is created
// AUTOMATICALLY (signup / approval) with the owner's TokoΦ email; the seller never sees or pastes a key
// (owner O7/O10). "Hubungkan" and "Perbarui kunci" open or change a legal account in the owner's name,
// so they need `settings:write` (owner-only, rbac-policy.ts). "Bayar ongkir" spends the store's
// Mengantar wallet on a booking the seller already made → `orders:write`, the capability that booked it.

export type MengantarCardState = Omit<MgAccountStatus, "retryAfterAt" | "connectedAt" | "updatedAt"> & {
  balance: number | null;
  connectedAt: string | null;
  /** Whether THIS store's checkout quotes through Mengantar now, and the first reason it does not. */
  checkout: MengantarReadiness;
  /** False = the platform cannot register accounts in this env yet → the card shows no connect button. */
  canRegister: boolean;
};

/** Whether a "Hubungkan" click can reach the Partner API at all in this env (origin + credential). */
const canRegister = (m: { partnerBase: string | null; partnerId: string | null; partnerSecret: string | null }) => !!(m.partnerBase && m.partnerId && m.partnerSecret);

/** One computation for every screen that says whether checkout uses Mengantar (card + Jasa Kirim). */
async function readinessFor(storeId: string, state: string, lastErrorCode: string | null): Promise<MengantarReadiness> {
  const [cfg, [pickup]] = await Promise.all([
    getProviderConfig(),
    withTenant(storeId, (db) =>
      db
        .select({ kecamatan: schema.storeSettings.senderKecamatanId, area: schema.storeSettings.senderMengantarAreaId })
        .from(schema.storeSettings)
        .limit(1),
    ),
  ]);
  return mengantarReadiness({
    switchOn: cfg.shipping === "mengantar",
    envNamed: cfg.mengantar.envSource === "env",
    canRegister: canRegister(cfg.mengantar),
    state,
    lastErrorCode,
    hasPickupAddress: pickup?.kecamatan != null,
    hasPickupArea: !!pickup?.area?.trim(),
  });
}

/**
 * For the Jasa Kirim card (any role that can open Pengaturan → Pengiriman): does this store's checkout
 * quote through Mengantar now? Read-only, names no secret, so a session is enough.
 */
export async function getShippingViaMengantar(): Promise<boolean> {
  const session = await getSession();
  if (!session) return false;
  const s = await mengantarAccountStatus(session.storeId);
  return (await readinessFor(session.storeId, s.state, s.lastErrorCode)).active;
}

/**
 * The Dashboard banner: `null` unless the platform quotes through Mengantar, THIS store is not on it,
 * and the viewer holds `settings:write` (both fixes need it). Read-only; called by the server page.
 */
export async function getMengantarDashboardNotice(): Promise<MengantarNotice | null> {
  const session = await getSession();
  if (!session) return null;
  const canFix = can(session.role, "settings:write");
  if (!canFix) return null; // nobody to act → skip the reads entirely
  const s = await mengantarAccountStatus(session.storeId);
  return mengantarNotice(await readinessFor(session.storeId, s.state, s.lastErrorCode), canFix);
}

/** Read for the Pengaturan card (owner-only screen section; the read itself names no secret). */
export async function getMengantarCard(): Promise<MengantarCardState> {
  const { storeId } = await requireCapability("settings:write");
  const s = await mengantarAccountStatus(storeId);
  const [balance, checkout, cfg] = await Promise.all([
    s.state === "connected" ? mengantarStoreBalance(storeId) : Promise.resolve(null),
    readinessFor(storeId, s.state, s.lastErrorCode),
    getProviderConfig(),
  ]);
  return {
    env: s.env,
    state: s.state,
    sellerId: s.sellerId,
    partnerId: s.partnerId,
    keyHint: s.keyHint,
    ownerEmail: s.ownerEmail,
    lastErrorCode: s.lastErrorCode,
    lastError: s.lastError,
    connectedAt: s.connectedAt ? s.connectedAt.toISOString() : null,
    balance,
    checkout,
    canRegister: canRegister(cfg.mengantar),
  };
}

/** "Hubungkan Mengantar" — register (or re-try) the store's own account. The click is the owner's consent. */
export async function connectMengantar(): Promise<{ ok: boolean; message: string }> {
  const session = await requireCapability("settings:write");
  // The click IS the owner's agreement to Mengantar's Terms + Privacy, recorded in the owner's name. An
  // operator in "Buka Dashboard Seller" carries the merchant's role and user id, so without this check a
  // Super Admin could consent for the owner — the exact thing the operator path (`source: "operator"`) is
  // not allowed to do.
  if (session.imp) return { ok: false, message: "Persetujuan Mengantar hanya bisa diberikan pemilik toko sendiri, bukan dari Super Admin." };
  const before = await mengantarAccountStatus(session.storeId);
  if (before.state === "connected") return { ok: true, message: "Akun Mengantar toko sudah terhubung." };
  const refusal = sellerConnectRefusal(before, Date.now());
  if (refusal) return { ok: false, message: refusal };
  const o = { source: "pengaturan" as const, actorUserId: session.userId };
  if (before.state !== "none") await requeueMengantar(session.storeId, o);
  const r = await connectStoreMengantar(session.storeId, o);
  revalidatePath("/pengaturan");
  return { ok: r.state === "connected", message: r.message };
}

/** "Perbarui kunci" — the system regenerates the key; nothing is shown. */
export async function rotateMengantarKey(): Promise<{ ok: boolean; message: string }> {
  const { storeId } = await requireCapability("settings:write");
  const r = await rotateStoreMengantarKey(storeId);
  revalidatePath("/pengaturan");
  return { ok: r.state === "connected", message: r.message };
}

/** "Bayar ongkir" on an order whose booking the store's wallet could not pay. */
export async function payMengantarShipping(orderNumber: string): Promise<{ ok: boolean; pending?: boolean; message: string }> {
  const { storeId } = await requireCapability("orders:write");
  const r = await payMengantarUnpaid(storeId, String(orderNumber ?? ""));
  revalidatePath(`/pesanan/${orderNumber}`);
  return r;
}
