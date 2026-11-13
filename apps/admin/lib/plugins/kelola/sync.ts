/**
 * The Kelola plugin's Postgres side (KELOLA_PLUGIN_SPEC.md §4.4). The wire format is `./wire.ts`.
 *
 * ⚠️ CROSS-TENANT BY NECESSITY, SCOPED BY HAND. The order hook (public order route) and the cron run
 * on the OWNER pool, where RLS does not apply — the same standing as `api/cron/tracking-events`. EVERY
 * statement here therefore carries an explicit `store_id`. Never widen one to "all rows of X".
 *
 * Delivery is at-least-once with ONE sender at a time:
 *   - WHAT may be pushed is one predicate (`orderEligible`), used by the hook, the cron and the claim.
 *     COD from creation; prepaid only once its payment is `berhasil` (Kelola is create-only — an
 *     unpaid prepaid push would sit in Kelola as "menunggu" forever); never `batal`/`retur`; never an
 *     order placed before the store first connected; never older than 7 days.
 *   - WHO may push it is decided by ONE statement (`claimOrder`) BEFORE any network call: insert-or-
 *     update the plugin row's `claimed_at` lease, conditional on not synced, not given up, and the
 *     previous attempt being older than the backoff. One row back ⇒ this caller owns the POST; zero ⇒
 *     someone else does, or it is done. Do NOT split it into a read then a write — that is the race.
 *     Kelola's `duplikat:true` is the second net, never the first.
 *   - `claimed_at` is NOT cleared after a failed attempt: it doubles as "last attempt time", which is
 *     what the backoff measures from. The minimum backoff equals the 5-minute lease, and every POST is
 *     bounded by `KELOLA_PUSH_TIMEOUT_MS` (15 s) — a request can never outlive its own lease.
 */
import "server-only";
import { db } from "@tokophi/db";
import { sql, type SQL } from "drizzle-orm";
import { decryptSecret, encryptSecret, encryptionAvailable } from "@/lib/crypto";
import {
  classifyKelolaResponse,
  kelolaLeadPayload,
  kelolaLeadUrl,
  kelolaOrderPayload,
  maskKelolaWebhookUrl,
  normalizeKelolaWebhookUrl,
  postKelola,
  redactKelola,
  testKelolaConnection,
  type KelolaConfig,
  type KelolaItemRow,
  type KelolaLeadRow,
  type KelolaOrderRow,
  type KelolaOutcome,
} from "./wire";

export const KELOLA = "kelola";
/** Orders/leads older than this are never pushed (a stated ceiling — spec §4.4). */
export const KELOLA_WINDOW_DAYS = 7;
/** Per store per cron tick, so one store's backlog cannot starve the rest. */
export const KELOLA_BATCH = 20;

/** Anything with drizzle's `execute` — the owner `db`, or a `withTenant` transaction. */
type Q = Pick<typeof db, "execute">;
type Fetch = typeof fetch;

/** The ONE definition of the sealed credential's scope — bound to store, plugin and version. */
export const kelolaScope = (storeId: string, v: number) => `${KELOLA}:${storeId}:v${v}`;

const rows = async <T>(q: Q, query: SQL) => (await q.execute(query)) as unknown as T[];

/** Backoff measured from `claimed_at` (= the last attempt): never shorter than the 5-minute lease. */
const due = (alias: string) => sql.raw(`(${alias}.claimed_at is null or ${alias}.claimed_at < now() - case
  when ${alias}.attempts <= 1 then interval '5 minutes'
  when ${alias}.attempts = 2 then interval '30 minutes'
  else interval '2 hours' end)`);

// ── configuration ──────────────────────────────────────────────────────────────────────────────

export type KelolaStore = {
  config: KelolaConfig;
  pushLeads: boolean;
  connectedAt: Date;
};

type PluginRow = {
  enabled: boolean;
  settings: Record<string, unknown> | null;
  secret_enc: string | null;
  secret_v: number;
  connected_at: Date | string | null;
  broken_at: Date | string | null;
};

async function pluginRow(q: Q, storeId: string): Promise<PluginRow | null> {
  const [r] = await rows<PluginRow>(q, sql`
    select enabled, settings, secret_enc, secret_v, connected_at, broken_at
      from store_plugins where store_id = ${storeId} and plugin = ${KELOLA}`);
  return r ?? null;
}

function openSecret(storeId: string, r: PluginRow): KelolaConfig | null {
  if (!r.secret_enc || !encryptionAvailable()) return null;
  const plain = decryptSecret(r.secret_enc, kelolaScope(storeId, r.secret_v));
  if (!plain) return null;
  try {
    const v = JSON.parse(plain) as { webhook_url?: unknown; webhook_secret?: unknown };
    const url = normalizeKelolaWebhookUrl(v.webhook_url);
    return url && typeof v.webhook_secret === "string" && v.webhook_secret ? { url, secret: v.webhook_secret } : null;
  } catch {
    return null;
  }
}

/** The store's working Kelola connection, or null = the plugin does nothing for this store. */
export async function loadKelolaStore(q: Q, storeId: string): Promise<KelolaStore | null> {
  const r = await pluginRow(q, storeId);
  if (!r || !r.enabled || r.broken_at || !r.connected_at) return null;
  const config = openSecret(storeId, r);
  if (!config) return null;
  return { config, pushLeads: r.settings?.push_leads === true, connectedAt: new Date(r.connected_at) };
}

/** What the settings page may show. Never the URL's token, never the secret. */
export async function kelolaSettingsView(q: Q, storeId: string) {
  const r = await pluginRow(q, storeId);
  const config = r ? openSecret(storeId, r) : null;
  return {
    installed: Boolean(r),
    enabled: Boolean(r?.enabled),
    configured: Boolean(config),
    maskedUrl: config ? maskKelolaWebhookUrl(config.url) : null,
    pushLeads: r?.settings?.push_leads === true,
    connectedAt: r?.connected_at ? new Date(r.connected_at) : null,
    brokenAt: r?.broken_at ? new Date(r.broken_at) : null,
    encryptionReady: encryptionAvailable(),
  };
}

/**
 * Save the URL + secret — but only after Kelola has accepted them (spec §6: a failed test stores
 * nothing). An empty secret keeps the stored one (AdsBookCMS behaviour), so rotating the URL alone
 * does not force re-typing the secret. `connected_at` is set on the FIRST connection only: moving it
 * on a re-save would silently drop every order placed while the credential was broken.
 */
export async function saveKelolaConnection(
  q: Q,
  storeId: string,
  input: { url: unknown; secret: unknown },
  fetcher: Fetch = fetch,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  if (!encryptionAvailable()) return { ok: false, error: "Kunci enkripsi server belum diset — koneksi tidak bisa disimpan." };
  const url = normalizeKelolaWebhookUrl(input.url);
  if (!url) return { ok: false, error: "URL webhook harus berupa URL HTTPS dari Kelola (…/api/public/toko/order/…)." };
  const r = await pluginRow(q, storeId);
  if (!r?.enabled) return { ok: false, error: "Aktifkan plugin Kelola terlebih dahulu." };
  const typed = typeof input.secret === "string" ? input.secret.trim() : "";
  const secret = typed || openSecret(storeId, r)?.secret || "";
  if (!secret) return { ok: false, error: "Secret wajib diisi." };

  const test = await testKelolaConnection({ url, secret }, fetcher);
  if (!test.ok) return { ok: false, error: test.message };

  const v = r.secret_v + 1;
  const blob = encryptSecret(JSON.stringify({ webhook_url: url, webhook_secret: secret }), kelolaScope(storeId, v));
  await q.execute(sql`
    update store_plugins
       set secret_enc = ${blob}, secret_v = ${v},
           settings = settings || ${JSON.stringify({ webhook_url_masked: maskKelolaWebhookUrl(url) })}::jsonb,
           connected_at = coalesce(connected_at, now()), broken_at = null, updated_at = now()
     where store_id = ${storeId} and plugin = ${KELOLA}`);
  return { ok: true, message: test.message };
}

/** Forget the credential. Push state stays (Hapus data is what deletes it). */
export async function disconnectKelola(q: Q, storeId: string) {
  await q.execute(sql`
    update store_plugins
       set secret_enc = null, connected_at = null, broken_at = null,
           settings = settings - 'webhook_url_masked', updated_at = now()
     where store_id = ${storeId} and plugin = ${KELOLA}`);
}

export async function setKelolaPushLeads(q: Q, storeId: string, on: boolean) {
  await q.execute(sql`
    update store_plugins set settings = settings || ${JSON.stringify({ push_leads: on })}::jsonb, updated_at = now()
     where store_id = ${storeId} and plugin = ${KELOLA}`);
}

// ── eligibility + claim (orders) ───────────────────────────────────────────────────────────────

/**
 * THE predicate. `o` is the orders alias. `force` (the seller's "Kirim ulang") drops the time window
 * and the connected-at floor — a person asked for this order — but never the payment or status rule.
 */
function orderEligible(storeId: string, connectedAt: Date, force = false): SQL {
  return sql`o.store_id = ${storeId}
    and o.status not in ('batal', 'retur')
    ${force ? sql.raw("") : sql`and o.placed_at >= ${connectedAt.toISOString()}::timestamptz and o.placed_at >= now() - make_interval(days => ${KELOLA_WINDOW_DAYS}::int)`}
    and coalesce((
      -- the ONE definition of "the order's payment" (data/orders.ts, data/order-detail.ts)
      select p.method = 'cod' or p.status = 'berhasil'
        from payments p where p.order_id = o.id
       order by p.paid_at desc nulls last, p.id desc limit 1
    ), false)`;
}

/** One statement decides who sends. Returns true = this caller owns the POST. */
export async function claimOrder(q: Q, storeId: string, orderId: string, connectedAt: Date, force = false) {
  const won = await rows<{ order_id: string }>(q, sql`
    insert into plugin_kelola_orders as k (store_id, order_id, claimed_at)
    select ${storeId}, o.id, now() from orders o
     where o.id = ${orderId} and ${orderEligible(storeId, connectedAt, force)}
    on conflict (store_id, order_id) do update set claimed_at = now()
     where k.synced_at is null and k.gave_up_at is null
       and ${force ? sql.raw(`(k.claimed_at is null or k.claimed_at < now() - interval '5 minutes')`) : due("k")}
    returning k.order_id`);
  return won.length === 1;
}

async function orderPayload(q: Q, storeId: string, orderId: string) {
  const [o] = await rows<{
    number: string; placed_at: Date | string; name: string | null; phone: string | null; address: string | null;
    kelurahan: string | null; city: string | null; province: string | null; district: string | null;
    postcode: string | null; shipping_idr: string | number; discount_idr: string | number; total_idr: string | number; method: string | null;
  }>(q, sql`
    select o.number, o.placed_at,
           coalesce(nullif(o.ship_recipient, ''), c.name) as name,
           coalesce(nullif(o.ship_phone, ''), c.phone) as phone,
           o.ship_address as address, o.ship_kelurahan_name as kelurahan,
           o.city, o.province, ka.district_name as district, o.ship_postcode as postcode,
           o.shipping_idr, o.discount_idr, o.total_idr,
           (select p.method from payments p where p.order_id = o.id
             order by p.paid_at desc nulls last, p.id desc limit 1) as method
      from orders o
      left join customers c on c.id = o.customer_id
      left join kiriminaja_areas ka on ka.id = o.ship_district_id
     where o.id = ${orderId} and o.store_id = ${storeId}`);
  if (!o) return null;
  const items = await rows<{ sku: string; name: string; quantity: number; unit_price: string | number; weight_grams: number }>(q, sql`
    select coalesce(nullif(pv.sku, ''), li.variant_id::text, li.id::text) as sku, li.title as name,
           li.qty as quantity, li.price_idr as unit_price, coalesce(pv.weight_grams, 0) as weight_grams
      from order_line_items li
      join orders o on o.id = li.order_id and o.store_id = ${storeId}  -- tenant boundary for the child table
      left join product_variants pv on pv.id = li.variant_id
     where li.order_id = ${orderId}
     order by li.title, li.id`);
  const order: KelolaOrderRow = {
    order_number: o.number,
    created_at: new Date(o.placed_at).toISOString(),
    customer_name: o.name ?? "",
    customer_phone: o.phone ?? "",
    address: o.address ?? "",
    kelurahan: o.kelurahan,
    province: o.province ?? "",
    city: o.city ?? "",
    district: o.district ?? "",
    postal_code: o.postcode,
    shipping_cost: Number(o.shipping_idr),
    discount_amount: Number(o.discount_idr),
    total_amount: Number(o.total_idr),
    payment_method: o.method ?? "",
  };
  const lines: KelolaItemRow[] = items.map((i) => ({
    sku: i.sku, name: i.name, quantity: Number(i.quantity), unit_price: Number(i.unit_price), weight_grams: Number(i.weight_grams),
  }));
  return kelolaOrderPayload(order, lines);
}

// ── one send, its verdict recorded ─────────────────────────────────────────────────────────────

/** A Kelola write under `NODE_ENV=test` refuses without an injected fetch (no unapproved network write). */
function guardedFetch(fetcher: Fetch | undefined): Fetch {
  if (process.env.NODE_ENV === "test" && !fetcher) throw new Error("Kelola push refused: tests must inject fetch.");
  return fetcher ?? fetch;
}

async function send(
  config: KelolaConfig,
  url: string,
  body: string,
  fetcher: Fetch,
): Promise<{ outcome: KelolaOutcome; error: string | null; remoteId: string | null; note: string | null }> {
  try {
    const res = await postKelola(url, config.secret, body, fetcher);
    const outcome = classifyKelolaResponse(res.status);
    const text = await res.text().catch(() => "");
    if (outcome === "synced") {
      let parsed: { id?: unknown; duplikatDari?: unknown } = {};
      try { parsed = JSON.parse(text); } catch { /* a 2xx without JSON is still accepted */ }
      return {
        outcome,
        error: null,
        remoteId: parsed.id == null ? null : String(parsed.id),
        note: parsed.duplikatDari == null ? null : `Kelola menandai duplikat dari ${String(parsed.duplikatDari)}`,
      };
    }
    return { outcome, error: redactKelola(`HTTP ${res.status}: ${text.slice(0, 300)}`, config), remoteId: null, note: null };
  } catch (e) {
    return { outcome: "retry", error: redactKelola(e instanceof Error ? e.message : String(e), config), remoteId: null, note: null };
  }
}

async function markBroken(storeId: string) {
  await db.execute(sql`update store_plugins set broken_at = now(), updated_at = now()
                        where store_id = ${storeId} and plugin = ${KELOLA} and broken_at is null`);
}

export type PushResult = KelolaOutcome | "skipped";

/**
 * Push one order if this caller wins the claim. Never throws: every outcome lands on the row.
 * `force` = the seller's "Kirim ulang" (clears a give-up, ignores the window, keeps the lease).
 */
export async function pushKelolaOrder(
  store: KelolaStore,
  storeId: string,
  orderId: string,
  opts: { fetch?: Fetch; force?: boolean } = {},
): Promise<PushResult> {
  const fetcher = guardedFetch(opts.fetch);
  if (opts.force) {
    await db.execute(sql`update plugin_kelola_orders set gave_up_at = null
                          where store_id = ${storeId} and order_id = ${orderId} and synced_at is null`);
  }
  if (!(await claimOrder(db, storeId, orderId, store.connectedAt, opts.force))) return "skipped";
  let r: Awaited<ReturnType<typeof send>>;
  const payload = await orderPayload(db, storeId, orderId).catch(() => null);
  if (!payload || payload.items.length === 0) {
    r = { outcome: "gave_up", error: "Pesanan tanpa item — tidak dikirim.", remoteId: null, note: null };
  } else {
    r = await send(store.config, store.config.url, JSON.stringify(payload), fetcher);
  }
  await db.execute(sql`
    update plugin_kelola_orders
       set attempts = attempts + 1,
           synced_at = ${r.outcome === "synced" ? sql`now()` : sql`null`},
           gave_up_at = ${r.outcome === "gave_up" ? sql`now()` : sql`null`},
           last_error = ${r.error}, last_note = coalesce(${r.note}, last_note),
           remote_id = coalesce(${r.remoteId}, remote_id)
     where store_id = ${storeId} and order_id = ${orderId}`);
  if (r.outcome === "broken") await markBroken(storeId);
  if (r.error) console.error("[kelola] order push", { storeId, orderId, outcome: r.outcome, error: r.error });
  return r.outcome;
}

/** Cron leg: the oldest due orders of ONE store. Stops the store on a refused credential. */
export async function drainKelolaOrders(store: KelolaStore, storeId: string, fetcher?: Fetch) {
  const due_ = await rows<{ id: string }>(db, sql`
    select o.id from orders o
      left join plugin_kelola_orders k on k.store_id = ${storeId} and k.order_id = o.id
     where ${orderEligible(storeId, store.connectedAt)}
       and (k.order_id is null or (k.synced_at is null and k.gave_up_at is null and ${due("k")}))
     order by o.placed_at, o.id
     limit ${KELOLA_BATCH}`);
  let synced = 0;
  for (const { id } of due_) {
    const out = await pushKelolaOrder(store, storeId, id, { fetch: fetcher });
    if (out === "synced") synced += 1;
    if (out === "broken") break;
  }
  return synced;
}

// ── leads (abandoned checkouts, opt-in) ────────────────────────────────────────────────────────

/**
 * A session is a lead only once the storefront has STORED it as `ditinggal` — never `aktif` (the
 * shopper may still be typing), never one that later became an order, never without a phone (leads
 * are worked on WhatsApp) or a name Kelola will accept.
 * ⚠️ The aktif→ditinggal flip is the storefront's opportunistic sweep (checkout-session.ts), which
 * only runs while that store receives checkout traffic — a quiet store's leads wait for it.
 */
function leadEligible(storeId: string, connectedAt: Date): SQL {
  return sql`s.store_id = ${storeId}
    and s.status = 'ditinggal' and s.recovered_at is null
    and s.phone is not null and length(trim(coalesce(s.name, ''))) >= 2
    and s.abandoned_at >= ${connectedAt.toISOString()}::timestamptz and s.abandoned_at >= now() - make_interval(days => ${KELOLA_WINDOW_DAYS}::int)`;
}

async function pushKelolaLead(store: KelolaStore, storeId: string, sessionId: string, fetcher: Fetch): Promise<PushResult> {
  const won = await rows<{ session_id: string }>(db, sql`
    insert into plugin_kelola_leads as k (store_id, session_id, claimed_at)
    select ${storeId}, s.id, now() from checkout_sessions s
     where s.id = ${sessionId} and ${leadEligible(storeId, store.connectedAt)}
    on conflict (store_id, session_id) do update set claimed_at = now()
     where k.synced_at is null and k.gave_up_at is null and ${due("k")}
    returning k.session_id`);
  if (won.length !== 1) return "skipped";
  const [s] = await rows<{
    id: string; name: string; phone: string; address: string | null; city: string | null; province: string | null;
    district: string | null; subtotal_idr: string | number; product: string | null;
  }>(db, sql`
    select s.id, s.name, s.phone, s.address, s.city, s.province, ka.district_name as district, s.subtotal_idr,
           s.items -> 0 ->> 'name' as product
      from checkout_sessions s left join kiriminaja_areas ka on ka.id = s.district_id
     where s.id = ${sessionId} and s.store_id = ${storeId}`);
  const lead: KelolaLeadRow = {
    code: s.id, customer_name: s.name.trim(), customer_phone: s.phone, address: s.address ?? "",
    province: s.province ?? "", city: s.city ?? "", district: s.district ?? "",
    total_amount: Number(s.subtotal_idr), source_page_path: null, product: s.product,
  };
  const r = await send(store.config, kelolaLeadUrl(store.config.url), JSON.stringify(kelolaLeadPayload(lead)), fetcher);
  await db.execute(sql`
    update plugin_kelola_leads
       set attempts = attempts + 1,
           synced_at = ${r.outcome === "synced" ? sql`now()` : sql`null`},
           gave_up_at = ${r.outcome === "gave_up" ? sql`now()` : sql`null`},
           last_error = ${r.error}
     where store_id = ${storeId} and session_id = ${sessionId}`);
  if (r.outcome === "broken") await markBroken(storeId);
  if (r.error) console.error("[kelola] lead push", { storeId, sessionId, outcome: r.outcome, error: r.error });
  return r.outcome;
}

export async function drainKelolaLeads(store: KelolaStore, storeId: string, fetcher?: Fetch) {
  if (!store.pushLeads) return 0;
  const f = guardedFetch(fetcher);
  const due_ = await rows<{ id: string }>(db, sql`
    select s.id from checkout_sessions s
      left join plugin_kelola_leads k on k.store_id = ${storeId} and k.session_id = s.id
     where ${leadEligible(storeId, store.connectedAt)}
       and (k.session_id is null or (k.synced_at is null and k.gave_up_at is null and ${due("k")}))
     order by s.abandoned_at, s.id
     limit ${KELOLA_BATCH}`);
  let synced = 0;
  for (const { id } of due_) {
    const out = await pushKelolaLead(store, storeId, id, f);
    if (out === "synced") synced += 1;
    if (out === "broken") break;
  }
  return synced;
}

// ── read models for the Seller screens ─────────────────────────────────────────────────────────

/** The order-detail panel. */
export type KelolaOrderState = {
  synced_at: Date | null; gave_up_at: Date | null; attempts: number; last_error: string | null; last_note: string | null;
};
export async function kelolaOrderState(q: Q, storeId: string, orderId: string): Promise<KelolaOrderState | null> {
  const [r] = await rows<KelolaOrderState>(q, sql`select synced_at, gave_up_at, attempts, last_error, last_note
              from plugin_kelola_orders where store_id = ${storeId} and order_id = ${orderId}`);
  return r ?? null;
}

/** The settings page's sync summary over the 7-day window. */
export async function kelolaSyncSummary(q: Q, storeId: string) {
  const [r] = await rows<{ synced: number; failing: number; gave_up: number; last_synced_at: Date | null }>(q, sql`
    select count(*) filter (where synced_at >= now() - make_interval(days => ${KELOLA_WINDOW_DAYS}::int))::int as synced,
           count(*) filter (where synced_at is null and gave_up_at is null and attempts > 0)::int as failing,
           count(*) filter (where gave_up_at is not null)::int as gave_up,
           max(synced_at) as last_synced_at
      from plugin_kelola_orders where store_id = ${storeId}`);
  const [last] = await rows<{ number: string; last_error: string; attempts: number }>(q, sql`
    select o.number, k.last_error, k.attempts
      from plugin_kelola_orders k join orders o on o.id = k.order_id and o.store_id = ${storeId}
     where k.store_id = ${storeId} and k.synced_at is null and k.last_error is not null
     order by k.claimed_at desc nulls last limit 1`);
  return { ...(r ?? { synced: 0, failing: 0, gave_up: 0, last_synced_at: null }), lastError: last ?? null };
}
