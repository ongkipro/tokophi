/**
 * Kelola CRM plugin (ADR 0021; AdsBookCMS `src/plugins/kelola/index.ts`). Pushes orders to Kelola's
 * Penjualan and — opt-in — abandoned checkouts to its lead inbox. The work lives in `./sync.ts`; this
 * file is what the registry sees.
 */
import "server-only";
import { db } from "@tokophi/db";
import { sql } from "drizzle-orm";
import type { Plugin } from "../registry";
import { KELOLA, drainKelolaLeads, drainKelolaOrders, loadKelolaStore, pushKelolaOrder } from "./sync";

export const kelolaPlugin: Plugin = {
  id: KELOLA,
  name: "Kelola CRM",
  description:
    "Kirim setiap pesanan ke Penjualan Kelola, dan (opsional) keranjang yang ditinggal ke Data tertinggal untuk di-follow up CS.",
  settingsHref: "/pengaturan?section=plugin",
  async uninstall(q, storeId) {
    await q.execute(sql`delete from plugin_kelola_orders where store_id = ${storeId}`);
    await q.execute(sql`delete from plugin_kelola_leads where store_id = ${storeId}`);
  },
  async onOrderCreated({ storeId }, orderId) {
    const store = await loadKelolaStore(db, storeId);
    // Not eligible yet (e.g. an unpaid prepaid order) answers "skipped" — the cron picks it up later.
    return store ? pushKelolaOrder(store, storeId, orderId) : "dormant";
  },
  async onCron({ storeId }) {
    const store = await loadKelolaStore(db, storeId);
    if (!store) return 0;
    const orders = await drainKelolaOrders(store, storeId);
    // A credential refused during the order leg marked the store broken — do not spend leads on it.
    const still = await loadKelolaStore(db, storeId);
    return orders + (still ? await drainKelolaLeads(still, storeId) : 0);
  },
};
