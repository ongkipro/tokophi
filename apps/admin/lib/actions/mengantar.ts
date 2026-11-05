"use server";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import {
  connectStoreMengantar,
  mengantarAccountStatus,
  requeueMengantar,
  sellerConnectRefusal,
  rotateStoreMengantarKey,
  type MgAccountStatus,
} from "@tokophi/db/mengantar-account";
import { mengantarStoreBalance, payMengantarUnpaid } from "@/lib/mengantar-shipping";

// Mengantar Partner Business API — the Seller's own actions. The store's Mengantar account is created
// AUTOMATICALLY (signup / approval) with the owner's TokoΦ email; the seller never sees or pastes a key
// (owner O7/O10). "Hubungkan" and "Perbarui kunci" open or change a legal account in the owner's name,
// so they need `settings:write` (owner-only, rbac-policy.ts). "Bayar ongkir" spends the store's
// Mengantar wallet on a booking the seller already made → `orders:write`, the capability that booked it.

export type MengantarCardState = Omit<MgAccountStatus, "retryAfterAt" | "connectedAt" | "updatedAt"> & { balance: number | null; connectedAt: string | null };

/** Read for the Pengaturan card (owner-only screen section; the read itself names no secret). */
export async function getMengantarCard(): Promise<MengantarCardState> {
  const { storeId } = await requireCapability("settings:write");
  const s = await mengantarAccountStatus(storeId);
  const balance = s.state === "connected" ? await mengantarStoreBalance(storeId) : null;
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
  };
}

/** "Hubungkan Mengantar" — register (or re-try) the store's own account. The click is the owner's consent. */
export async function connectMengantar(): Promise<{ ok: boolean; message: string }> {
  const session = await requireCapability("settings:write");
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
