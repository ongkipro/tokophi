/**
 * First-party plugins (ADR 0021 — the AdsBookCMS ADR-028 contract, ported to one multi-tenant Postgres).
 *
 * A plugin is product code under `lib/plugins/<id>/`, compiled in and written by us — never uploaded,
 * never customer code (PRD: still no marketplace). A store "installs" one by activating it at
 * Pengaturan → Plugin, which writes its `store_plugins` row. Until then the core never calls it for
 * that store: no hook, no rows, no menu entry (dormant = zero effect, AdsBookCMS ADR-027 §2).
 *
 * The core calls plugins through TWO hooks only, each failure isolated and logged, never thrown back:
 *   - `runOrderCreated(storeId, orderId)` — the public order route schedules it with `after()` AFTER
 *     its transaction has committed. It must never fail or delay an order.
 *   - `runPluginCron(now)` — `api/cron/plugins`, every store with an enabled, unbroken plugin row.
 *
 * Differences from AdsBookCMS, forced by Postgres multi-tenancy: a plugin's tables ship in a Drizzle
 * migration (shared, RLS'd) instead of being created on activation, so there is no `schema` in the
 * manifest, and uninstall deletes THIS store's rows instead of dropping tables.
 *
 * ⚠️ OWNER POOL for the hooks (no session in a public route or a cron): every query is scoped by an
 * explicit `store_id`. The settings actions go through `withTenant` like every other Seller write.
 */
import "server-only";
import { db } from "@tokophi/db";
import { sql } from "drizzle-orm";
import { kelolaPlugin } from "./kelola";

type Q = Pick<typeof db, "execute">;

export type PluginContext = { storeId: string };

export type Plugin = {
  id: string;
  name: string;
  description: string;
  /** Seller page that configures the plugin once it is active. */
  settingsHref: string;
  /** Statements run by "Hapus koneksi" (uninstall): delete THIS store's plugin rows. */
  uninstall: (q: Q, storeId: string) => Promise<void>;
  /**
   * Switched back ON after being OFF since `offSince`, inside the same transaction as the switch.
   * Marks whatever arrived while it was off as skipped, so the hooks never back-fill it.
   */
  onResume?(q: Q, storeId: string, offSince: Date): Promise<void>;
  /** After the order transaction committed. Runs outside the shopper's response. */
  onOrderCreated?(ctx: PluginContext, orderId: string): Promise<unknown>;
  /** Inside the plugin cron. Returns a count for the cron summary. */
  onCron?(ctx: PluginContext, now: Date): Promise<number>;
};

export const PLUGINS: readonly Plugin[] = [kelolaPlugin];

export function findPlugin(id: string) {
  return PLUGINS.find((p) => p.id === id) ?? null;
}

type Row = { plugin: string; enabled: boolean; activated_at: Date | null; disabled_at: Date | null };

/** What Pengaturan → Plugin lists: every compiled-in plugin and this store's state. */
export async function listPlugins(q: Q, storeId: string) {
  const rows = (await q.execute(sql`
    select plugin, enabled, activated_at, disabled_at from store_plugins where store_id = ${storeId}`)) as unknown as Row[];
  const byId = new Map(rows.map((r) => [r.plugin, r]));
  return PLUGINS.map((p) => {
    const r = byId.get(p.id);
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      settingsHref: p.settingsHref,
      installed: Boolean(r),
      enabled: Boolean(r?.enabled),
      activatedAt: r?.activated_at ?? null,
      disabledAt: r?.disabled_at ?? null,
    };
  });
}

/*
 * AKTIF / NONAKTIF — the semantics (owner 2026-11-13: "plugins (aktif, non aktif)"):
 *
 *   Aktifkan (first time)  → row written, `enabled`. The plugin still does nothing until it is CONNECTED
 *                            (Kelola: `connected_at`); nothing placed before the connection is ever sent.
 *   Nonaktifkan            → `enabled = false`, `disabled_at = now()`. Both hooks stop at once: the order
 *                            hook and the cron read `enabled` before anything else. The sealed credential,
 *                            the settings and the push history STAY, so switching back on needs no re-typing.
 *   Aktifkan (again)       → `enabled`, `disabled_at = null`, and the plugin's `onResume` marks every order
 *                            / lead that arrived while it was off as SKIPPED. They are NOT back-filled: the
 *                            seller said "off" for them, and PII sent anyway is the one thing that cannot be
 *                            taken back. Work that was pending from BEFORE the switch-off (a retry, a prepaid
 *                            order paid later) resumes normally. A skipped order can still be sent one at a
 *                            time with "Kirim ulang". Nothing here can double-send: every POST still goes
 *                            through the plugin's claim statement.
 *   Hapus koneksi          → uninstall: this store's plugin rows and its `store_plugins` row (credential
 *                            included) are deleted. A later activation starts from nothing.
 *
 * All three run inside the caller's tenant transaction (`withTenant`), so the switch and the skip-marking
 * commit together.
 */
export async function activatePlugin(q: Q, storeId: string, id: string) {
  const p = findPlugin(id);
  if (!p) return false;
  // Lock the row (if any) so a concurrent toggle cannot read the same `disabled_at` twice.
  const [prev] = (await q.execute(sql`
    select enabled, disabled_at from store_plugins
     where store_id = ${storeId} and plugin = ${id} for update`)) as unknown as { enabled: boolean; disabled_at: Date | string | null }[];
  await q.execute(sql`
    insert into store_plugins (store_id, plugin, enabled, activated_at) values (${storeId}, ${id}, true, now())
    on conflict (store_id, plugin) do update
      set enabled = true, disabled_at = null,
          activated_at = coalesce(store_plugins.activated_at, now()), updated_at = now()`);
  if (prev && !prev.enabled && prev.disabled_at && p.onResume) {
    await p.onResume(q, storeId, new Date(prev.disabled_at));
  }
  return true;
}

/** Hooks stop now; settings, credential and history stay for a re-activation. */
export async function deactivatePlugin(q: Q, storeId: string, id: string) {
  if (!findPlugin(id)) return false;
  await q.execute(sql`
    update store_plugins
       set enabled = false, disabled_at = case when enabled then now() else disabled_at end, updated_at = now()
     where store_id = ${storeId} and plugin = ${id}`);
  return true;
}

/** "Hapus koneksi": this store's plugin rows and its credential, gone. Not reversible. */
export async function uninstallPlugin(q: Q, storeId: string, id: string) {
  const p = findPlugin(id);
  if (!p) return false;
  await p.uninstall(q, storeId);
  await q.execute(sql`delete from store_plugins where store_id = ${storeId} and plugin = ${id}`);
  return true;
}

async function enabledFor(storeId: string) {
  const rows = (await db.execute(sql`
    select plugin from store_plugins where store_id = ${storeId} and enabled and broken_at is null`)) as unknown as { plugin: string }[];
  return rows.map((r) => findPlugin(r.plugin)).filter((p): p is Plugin => Boolean(p));
}

/**
 * Checkout leg. Call it ONLY from `after()`, and only once the order transaction has returned.
 * Never throws. With no active plugin the cost is one indexed read of `store_plugins`.
 */
export async function runOrderCreated(storeId: string, orderId: string) {
  try {
    for (const p of await enabledFor(storeId)) {
      if (!p.onOrderCreated) continue;
      await p.onOrderCreated({ storeId }, orderId).catch((e) =>
        console.error("[plugins] order hook failed", { plugin: p.id, storeId, orderId, error: e instanceof Error ? e.message : String(e) }),
      );
    }
  } catch (e) {
    console.error("[plugins] order hook failed", { storeId, orderId, error: e instanceof Error ? e.message : String(e) });
  }
}

/** Cron leg: every store's enabled, unbroken plugins; one failure never stops the rest. */
export async function runPluginCron(now: Date) {
  const rows = (await db.execute(sql`
    select store_id, plugin from store_plugins where enabled and broken_at is null order by store_id, plugin`)) as unknown as {
    store_id: string;
    plugin: string;
  }[];
  const counts: Record<string, number> = {};
  const failures: string[] = [];
  for (const r of rows) {
    const p = findPlugin(r.plugin);
    if (!p?.onCron) continue;
    try {
      counts[p.id] = (counts[p.id] ?? 0) + (await p.onCron({ storeId: r.store_id }, now));
    } catch (e) {
      failures.push(`${p.id}:${r.store_id}`);
      console.error("[plugins] cron failed", { plugin: p.id, storeId: r.store_id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { stores: new Set(rows.map((r) => r.store_id)).size, counts, failures };
}
