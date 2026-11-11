import "server-only";
import { db, schema } from "@tokophi/db";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { mgTrackByCnote, mgTrackByOrderId, type MgCallOptions, type MgResult, type MgTracking } from "@tokophi/lib/mengantar";
import { openFailureMessage, openStoreMengantar, refreshStoreMengantarKey, type MgOpen } from "@tokophi/db/mengantar-account";
import { MengantarNotWhitelistedError } from "@tokophi/lib/mengantar";
import { syncOrderFromKa } from "@/lib/ka-tracking";
import { withTenant } from "@/lib/tenant";
import { SHIPPING_SERVICE } from "@tokophi/lib/provider-label";
import type { TrackResult } from "@/lib/actions/shipping";

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// SHIP-MENGANTAR phase 3 — tracking for orders stamped `shipping_provider = 'mengantar'`.
//
// ONE writer, shared with KiriminAja: every fact lands through `syncOrderFromKa` (provider-neutral in
// everything but its name — it takes an outcome, a waybill and a cancel reply). That keeps the
// forward-only RANK, the problem flag, the cancellation reconciler and `applyOrderStatusChange` the
// same for both providers.
//
// 🔴 A WAYBILL IS NOT A PICKUP (risk R5). Mengantar returns `cnote_no` AT BOOKING, before a courier
// has touched the parcel. The waybill fills `orders.awb`; the STATUS comes only from
// `outcomeFromMengantar` (PENDING PICKUP → booked → stays `diproses`; PICKED UP / ON DELIVERY →
// `dikirim`; DELIVERED → `selesai`; RTS → `retur`; CANCELED → `batal` / the void reconciler).
//
// PARTNER MODEL: every pull uses THE ORDER'S OWN seller account (`mg_env` + `mg_seller_id` → that
// store's key, `openStoreMengantar`). An order whose account the store no longer holds is skipped and
// counted (`accountMissing`), never pulled with another key. Polling only — no webhook (owner O9).
// ─────────────────────────────────────────────────────────────────────────────────────────────────

export const MG_PER_STORE_BATCH = 5;

type Pollable = {
  number: string;
  awb: string | null;
  mgOrderId: string | null;
  mgOrderCode: string | null;
  mgIsPaid: boolean | null;
  /** When the active booking was accepted — a "not found" younger than MG_VANISH_MIN_AGE_MS is not trusted. */
  bookedAt?: Date | string | null;
};

/** A shipment booked less than this long ago may simply not be indexed yet: "not found" is not news. */
export const MG_VANISH_MIN_AGE_MS = 30 * 60_000;
/** Transport only — the account is never chosen by the caller. */
export type MgPullOptions = Omit<MgCallOptions, "cfg">;

/** A waybill only if it is one: not our provider ids echoed back. */
function realCnote(t: MgTracking, o: Pick<Pollable, "mgOrderId" | "mgOrderCode">): string | null {
  const c = t.cnoteNo?.trim();
  if (!c || c === o.mgOrderId || c === o.mgOrderCode) return null;
  return c;
}

/** Pull by waybill when we hold one, else by ORDER_ID (a booking whose cnote is still null). */
export function pullMengantar(o: Pollable, opts?: MgCallOptions): Promise<MgResult<MgTracking | null>> | null {
  if (o.awb) return mgTrackByCnote(o.awb, opts);
  if (o.mgOrderCode) return mgTrackByOrderId(o.mgOrderCode, opts);
  return null;
}

/** The seller's words when a booked shipment vanished from their Mengantar account. */
export const MG_VANISHED_NOTE =
  "Pengiriman ini tidak lagi ditemukan di akun Mengantar toko (mungkin dihapus dari aplikasi Mengantar). Klik Batal pengiriman lalu atur pengiriman ulang, atau hubungi dukungan TokoΦ.";

/**
 * Apply one verified pull to one order. `t === null` = the provider answered "no such shipment".
 * With a pending cancellation that is the reconciler's `not_found` (a human looks). WITHOUT one it is
 * still news: each seller owns their Mengantar account and can delete a shipment there, and a deleted
 * order VANISHES (sandbox E2E 2026-11-05) — so the order is flagged instead of polled in silence. The
 * flag is self-healing: the next real status clears `problem_at` (`syncOrderFromKa`).
 */
export async function applyMengantarPull(o: Pollable, t: MgTracking | null, pendingCancel: boolean, now: number = Date.now()): Promise<string[]> {
  const guard = { mgOrderId: o.mgOrderId };
  if (!t) {
    if (pendingCancel) return (await syncOrderFromKa(o.number, null, null, null, { kind: "not_found" }, null, guard)).changed;
    const age = o.bookedAt ? now - new Date(o.bookedAt).getTime() : Infinity;
    if (!(age >= MG_VANISH_MIN_AGE_MS)) return [];
    return (await syncOrderFromKa(o.number, "problem", null, MG_VANISHED_NOTE, undefined, null, guard)).changed;
  }
  const cnote = realCnote(t, o);
  const outcome = t.outcome;
  if (!cnote && !outcome) return [];
  const note =
    outcome === "problem"
      ? `Kurir melaporkan kendala pengiriman (${(t.flags[0] ?? "status tidak dikenal").slice(0, 60)}). Hubungi kurir atau pembeli untuk memastikan paket.`
      : null;
  const s = await syncOrderFromKa(o.number, outcome, cnote, note, undefined, null, guard);
  // A waybill only exists once the shipment is paid for: an unpaid booking (`false`), or one whose
  // pay-unpaid outcome is still unknown (`null`, Super Admin claim), that now has one WAS paid.
  if (cnote && o.mgIsPaid !== true) {
    const paid = await db
      .update(schema.orders)
      .set({ mgIsPaid: true })
      .where(and(eq(schema.orders.number, o.number), or(isNull(schema.orders.mgIsPaid), eq(schema.orders.mgIsPaid, false))))
      .returning({ id: schema.orders.id });
    if (paid.length) s.changed.push("paid");
  } else if (!cnote && t.isPaid === false && o.mgIsPaid === null) {
    // A "Bayar ongkir" whose answer was lost, and the provider says it is still unpaid → payable again.
    const back = await db
      .update(schema.orders)
      .set({ mgIsPaid: false })
      .where(and(eq(schema.orders.number, o.number), isNull(schema.orders.mgIsPaid)))
      .returning({ id: schema.orders.id });
    if (back.length) s.changed.push("unpaid");
  }
  return s.changed;
}

export type MgSweepSummary = { scanned: number; advanced: number; awbFilled: number; problems: number; cancelsReconciled: number; errors: number; accountMissing: number };

/**
 * The cron half: every Mengantar order booked and not finished (`diproses`/`dikirim`), five per store
 * per tick, round-robin across stores — the same fairness the KiriminAja poller uses. Idempotent:
 * the sync is forward-only, so a second sidecar or a webhook racing this sweep re-applies the same
 * fact and changes nothing (the order row lock in `syncOrderFromKa` serialises them).
 */
export async function sweepMengantarTracking(opts?: MgPullOptions): Promise<MgSweepSummary> {
  const rows = (await db.execute(sql`
    with ranked as (
      select number, awb, mg_order_id as "mgOrderId", mg_order_code as "mgOrderCode", mg_is_paid as "mgIsPaid",
             store_id::text as "storeId", mg_env as "mgEnv", mg_seller_id as "mgSellerId",
             exists (select 1 from shipment_bookings b where b.order_id = orders.id and b.status = 'cancellation_requested') as "pendingCancel",
             (select max(b.accepted_at) from shipment_bookings b where b.order_id = orders.id) as "bookedAt",
             -- ROTATING order (a per-minute hash), not placed_at: with a fixed order a store with more
             -- than MG_PER_STORE_BATCH live shipments never re-polls the tail, so a flagged order would
             -- never be re-read (and never cleared). Every order comes round within a few ticks.
             row_number() over (partition by store_id order by md5(id::text || to_char(now(), 'YYYYMMDDHH24MI'))) as poll_round
        from orders
       where shipping_provider = 'mengantar'
         and mg_order_id is not null
         -- 'baru' too: a booking an operator ADOPTED from an unknown outcome (Super Admin) never went
         -- through the booking's own baru → diproses; the first tracked status moves it, via the state machine.
         and status in ('baru', 'diproses', 'dikirim')
    )
    select number, awb, "mgOrderId", "mgOrderCode", "mgIsPaid", "storeId", "mgEnv", "mgSellerId", "pendingCancel", "bookedAt"
      from ranked where poll_round <= ${MG_PER_STORE_BATCH}
     order by poll_round, "storeId"
  `)) as unknown as (Pollable & { storeId: string; mgEnv: string | null; mgSellerId: string | null; pendingCancel: boolean })[];

  const sum: MgSweepSummary = { scanned: rows.length, advanced: 0, awbFilled: 0, problems: 0, cancelsReconciled: 0, errors: 0, accountMissing: 0 };
  // One opener read per (store, env, seller) per tick.
  const accounts = new Map<string, Promise<MgOpen>>();
  for (const o of rows) {
    try {
      const k = `${o.storeId}:${o.mgEnv}:${o.mgSellerId}`;
      if (!accounts.has(k)) accounts.set(k, openStoreMengantar(o.storeId, o));
      const acc = await accounts.get(k)!;
      if (!acc.ok) {
        sum.accountMissing++;
        console.log("[cron/tracking][mg-raw]", `order=${JSON.stringify(o.number)} skipped account=${acc.reason}`);
        continue;
      }
      const pull = pullMengantar(o, { ...opts, cfg: acc.cfg });
      if (!pull) continue;
      const r = await pull;
      if (!r.ok) {
        // A refusal with a 404 for a pending void = the provider no longer knows the shipment.
        if (o.pendingCancel && r.httpStatus === 404) {
          const ch = await applyMengantarPull(o, null, true);
          if (ch.some((c) => c.startsWith("cancel:"))) sum.cancelsReconciled++;
        }
        console.log("[cron/tracking][mg-raw]", `order=${JSON.stringify(o.number)} ok=false httpStatus=${r.httpStatus}`);
        continue;
      }
      const t = r.data;
      // Evidence line, no PII: status flags + waybill + outcome only.
      console.log(
        "[cron/tracking][mg-raw]",
        `order=${JSON.stringify(o.number)} ok=true found=${!!t} flags=${JSON.stringify(t?.flags ?? [])} outcome=${t?.outcome ?? "unmapped"} cnote=${JSON.stringify(t?.cnoteNo ?? null)}`,
      );
      if (t?.outcome === "problem") sum.problems++;
      const ch = await applyMengantarPull(o, t, o.pendingCancel);
      if (ch.some((c) => c.startsWith("awb"))) sum.awbFilled++;
      if (ch.some((c) => c.startsWith("status"))) sum.advanced++;
      if (ch.some((c) => c.startsWith("cancel:"))) sum.cancelsReconciled++;
    } catch (err) {
      console.error("[cron/tracking] mg pull/sync failed", o.number, err instanceof Error ? err.name : err);
      // The sweep is where a store with no checkout traffic still heals a key its seller regenerated.
      if (err instanceof MengantarNotWhitelistedError) await refreshStoreMengantarKey(o.storeId);
      sum.errors++;
    }
  }
  return sum;
}

/** The seller's "Lacak" for a Mengantar order (`trackShipment` dispatches here). Same writer as the poller. */
export async function trackMengantar(storeId: string, orderNumber: string, opts?: MgPullOptions): Promise<TrackResult> {
  const [o] = await withTenant(storeId, (tx) =>
    tx
      .select({ number: schema.orders.number, awb: schema.orders.awb, mgOrderId: schema.orders.mgOrderId, mgOrderCode: schema.orders.mgOrderCode, mgIsPaid: schema.orders.mgIsPaid, mgEnv: schema.orders.mgEnv, mgSellerId: schema.orders.mgSellerId })
      .from(schema.orders)
      .where(eq(schema.orders.number, orderNumber))
      .limit(1),
  );
  const ref = o?.mgOrderCode ?? o?.mgOrderId ?? null;
  if (!o?.mgOrderId) return { ok: false, message: "Pesanan ini belum punya pengiriman.", history: [] };
  const acc = await openStoreMengantar(storeId, o);
  if (!acc.ok) return { ok: false, kaOrderId: ref, awb: o.awb, history: [], message: openFailureMessage(acc.reason) };
  const pull = pullMengantar(o, { ...opts, cfg: acc.cfg });
  if (!pull) return { ok: false, message: "Pesanan ini belum punya pengiriman.", history: [] };
  let r: MgResult<MgTracking | null>;
  try {
    r = await pull;
  } catch {
    return { ok: false, pending: true, kaOrderId: ref, awb: o.awb, history: [], message: `${SHIPPING_SERVICE} sedang tidak bisa dihubungi. Coba lagi sebentar.` };
  }
  if (!r.ok) return { ok: false, kaOrderId: ref, awb: o.awb, history: [], message: r.error || "Tracking belum tersedia." };
  const t = r.data;
  if (!t) return { ok: false, pending: true, kaOrderId: ref, awb: o.awb, history: [], message: `${SHIPPING_SERVICE} belum punya data lacak untuk pengiriman ini.` };
  await applyMengantarPull(o, t, false);
  const awb = realCnote(t, o) ?? o.awb;
  return {
    ok: true,
    awb,
    kaOrderId: ref,
    status: t.flags.join(", ") || null,
    history: t.histories,
    pending: t.histories.length === 0,
    message: awb && awb !== o.awb ? `Nomor resi kurir diterima: ${awb}` : t.histories.length ? `Update terakhir: ${t.histories[t.histories.length - 1].desc}` : `Pengiriman terdaftar di ${SHIPPING_SERVICE} — belum ada pergerakan dari kurir.`,
  };
}
