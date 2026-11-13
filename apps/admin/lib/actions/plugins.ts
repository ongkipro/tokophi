"use server";
import { revalidatePath } from "next/cache";
import { sql, type SQL } from "drizzle-orm";
import { requireCapability } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";
import { activatePlugin, deactivatePlugin, findPlugin, listPlugins, uninstallPlugin } from "@/lib/plugins/registry";
import {
  disconnectKelola,
  kelolaOrderState,
  kelolaSettingsView,
  kelolaSyncSummary,
  loadKelolaStore,
  pushKelolaOrder,
  saveKelolaConnection,
  setKelolaPushLeads,
} from "@/lib/plugins/kelola/sync";

// Pengaturan → Plugin (ADR 0019, KEL-001). Activating a plugin and pasting its credential is
// `plugins:manage` — OWNER ONLY (rbac-policy.ts): Kelola receives every order's shopper name, WhatsApp
// and address. "Kirim ulang" on one order is `orders:write`, the capability that runs the order.
// Every answer is `{ ok, message }` — Next masks a thrown Error in production, and a seller must be
// able to read why a credential was refused. The caller shows the message; it never assumes success.

type Result = { ok: true; message: string } | { ok: false; message: string };

/**
 * One RLS-scoped statement per call, instead of one transaction around the whole action: saving a
 * Kelola credential makes a live test call first (up to 15 s), and a tenant transaction must not stay
 * open across a network round-trip.
 */
const perStatement = (storeId: string) =>
  ({ execute: (q: SQL) => withTenant(storeId, (db) => db.execute(q)) }) as unknown as Parameters<typeof kelolaSettingsView>[0];

export type PluginCardState = {
  plugins: Awaited<ReturnType<typeof listPlugins>>;
  kelola: Awaited<ReturnType<typeof kelolaSettingsView>> & {
    sync: Awaited<ReturnType<typeof kelolaSyncSummary>> | null;
  };
};

export async function getPluginCard(): Promise<PluginCardState> {
  const { storeId } = await requireCapability("plugins:manage", { allowSuspended: true });
  return withTenant(storeId, async (db) => {
    const [plugins, kelola] = await Promise.all([listPlugins(db, storeId), kelolaSettingsView(db, storeId)]);
    const sync = kelola.installed ? await kelolaSyncSummary(db, storeId) : null;
    return { plugins, kelola: { ...kelola, sync } };
  });
}

export async function setPluginActive(id: string, on: boolean): Promise<Result> {
  const { storeId } = await requireCapability("plugins:manage");
  const p = findPlugin(id);
  if (!p) return { ok: false, message: "Plugin tidak dikenal." };
  await withTenant(storeId, (db) => (on ? activatePlugin(db, storeId, id) : deactivatePlugin(db, storeId, id)));
  revalidatePath("/pengaturan");
  return { ok: true, message: on ? `${p.name} diaktifkan.` : `${p.name} dinonaktifkan. Pengaturan & riwayatnya disimpan.` };
}

export async function removePluginData(id: string): Promise<Result> {
  const { storeId } = await requireCapability("plugins:manage");
  const p = findPlugin(id);
  if (!p) return { ok: false, message: "Plugin tidak dikenal." };
  await withTenant(storeId, (db) => uninstallPlugin(db, storeId, id));
  revalidatePath("/pengaturan");
  return { ok: true, message: `Data ${p.name} di toko ini dihapus.` };
}

export async function saveKelola(input: { url: string; secret: string }): Promise<Result> {
  const { storeId } = await requireCapability("plugins:manage");
  const r = await saveKelolaConnection(perStatement(storeId), storeId, input);
  revalidatePath("/pengaturan");
  return r.ok ? { ok: true, message: r.message } : { ok: false, message: r.error };
}

export async function disconnectKelolaAction(): Promise<Result> {
  const { storeId } = await requireCapability("plugins:manage");
  await withTenant(storeId, (db) => disconnectKelola(db, storeId));
  revalidatePath("/pengaturan");
  return { ok: true, message: "Kelola diputus. Pesanan baru tidak dikirim lagi." };
}

export async function setKelolaLeads(on: boolean): Promise<Result> {
  const { storeId } = await requireCapability("plugins:manage");
  await withTenant(storeId, (db) => setKelolaPushLeads(db, storeId, on));
  revalidatePath("/pengaturan");
  return { ok: true, message: on ? "Keranjang ditinggal akan dikirim ke Kelola." : "Keranjang ditinggal tidak dikirim lagi." };
}

export type KelolaOrderPanel = {
  active: boolean;
  state: Awaited<ReturnType<typeof kelolaOrderState>>;
};

/** Tenant boundary: the order's id, read by NUMBER under RLS (the detail route is keyed on the number). */
async function orderIdByNumber(storeId: string, number: string): Promise<string | null> {
  if (!number || number.length > 64) return null;
  return withTenant(storeId, async (db) => {
    const rows = (await db.execute(
      sql`select id from orders where number = ${number} and store_id = ${storeId} limit 1`,
    )) as unknown as { id: string }[];
    return rows[0]?.id ?? null;
  });
}

/** The order-detail panel. `active: false` = the plugin is off for this store → render nothing. */
export async function getKelolaOrderPanel(orderNumber: string): Promise<KelolaOrderPanel> {
  const { storeId } = await requireCapability("orders:write", { allowSuspended: true });
  const orderId = await orderIdByNumber(storeId, orderNumber);
  if (!orderId) return { active: false, state: null };
  return withTenant(storeId, async (db) => {
    const store = await loadKelolaStore(db, storeId);
    if (!store) return { active: false, state: null };
    return { active: true, state: await kelolaOrderState(db, storeId, orderId) };
  });
}

/** "Kirim ulang": the seller asked for this order — ignores the 7-day window, keeps the lease. */
export async function resendKelolaOrder(orderNumber: string): Promise<Result> {
  const { storeId } = await requireCapability("orders:write");
  const orderId = await orderIdByNumber(storeId, orderNumber);
  if (!orderId) return { ok: false, message: "Pesanan tidak ditemukan." };
  const store = await withTenant(storeId, (db) => loadKelolaStore(db, storeId));
  if (!store) return { ok: false, message: "Kelola belum terhubung, atau kredensialnya ditolak — periksa Pengaturan → Plugin." };
  const out = await pushKelolaOrder(store, storeId, orderId, { force: true });
  revalidatePath(`/pesanan/${orderNumber}`);
  if (out === "synced") return { ok: true, message: "Pesanan terkirim ke Kelola." };
  if (out === "skipped") {
    return { ok: false, message: "Belum bisa dikirim: pesanan prabayar yang belum lunas, sudah batal/retur, sudah terkirim, atau sedang dikirim — coba lagi sebentar." };
  }
  const state = await withTenant(storeId, (db) => kelolaOrderState(db, storeId, orderId));
  return { ok: false, message: `Kelola belum menerima pesanan ini: ${state?.last_error ?? "coba lagi nanti"}` };
}
