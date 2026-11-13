// Mengantar `POST /order` idempotencyKey replay probe — SANDBOX ONLY, through the REAL client
// (`packages/lib/src/mengantar.ts` `mgCreateOrder`). Answers one question with evidence: does the same
// `idempotencyKey` sent twice create ONE shipment or TWO? (Task SHIP-MENGANTAR-IDEMPOTENCY.)
//
// Sequence (strictly sequential — one POST /order in flight per seller account, trap 4 / 409):
//   A  key K1, body P            → a shipment
//   B  key K1, body P (replay)   → same `_id` = honoured; a new `_id` = NOT honoured (double-book)
//   C  key K2, body P (control)  → a new shipment is expected (no dedupe by destinationMark)
//   D  key K1, body P' (changed) → expected refusal (IDEMPOTENCY_KEY_REUSED)
//   then GET /order?batch= for every batch seen + GET /order?order_id= for every ORDER_ID, count the
//   live rows carrying this run's destinationMark, CANCEL every distinct `_id` (DELETE /order is keyed
//   by `_id`), and read back again.
//
// Prints non-secret facts only: HTTP status, ids, batch codes, counts. The seller key sits in the URL
// path — every printed path is redacted and the key is never logged.
//
// REFUSALS: NODE_ENV=test; no `--confirm-sandbox`; the key absent. The origin is HARD-CODED to the
// sandbox below — there is no flag that points this at production, on purpose (a production replay
// test would book real parcels and debit a real wallet).
//
// HOW TO RUN (from the repo root; the key comes only through secrets-env, read in-process):
//   NODE_OPTIONS="--import $PWD/ops/mengantar-live-hooks.mjs" \
//   secrets-env run -- npx tsx ops/mengantar-sandbox-idempotency.ts --confirm-sandbox
//
// Residue: a shipment the sandbox refuses to delete stays on the sandbox seller account; the script
// prints every `_id` it could not cancel — record them in BUILD-LOG.

import { mgCancel, mgCreateOrder, mgEstimate, mgPickupAddresses, mgSearchArea, redactKey, type MgCreateOrderInput } from "../packages/lib/src/mengantar";

const SANDBOX_BASE = "https://sandbox.mengantar.com"; // MENGANTAR_ORIGINS.sandbox.public — never production
const KEY_ENV = "GERAIEXPRESS_MENGANTAR_SANDBOX_SELLER_KEY";

function refuse(why: string): never {
  console.error(`mengantar-sandbox-idempotency REFUSED: ${why}`);
  process.exit(2);
}
const say = (step: string, facts: Record<string, unknown>) => console.log(`[${step}]`, JSON.stringify(facts));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

if (process.env.NODE_ENV === "test") refuse("NODE_ENV=test");
if (!process.argv.includes("--confirm-sandbox")) refuse("pass --confirm-sandbox");
const KEY = process.env[KEY_ENV]?.trim();
if (!KEY) refuse(`${KEY_ENV} not in the environment — run through \`secrets-env run --\``);
const cfg = { env: "sandbox" as const, base: SANDBOX_BASE, key: KEY };
const red = (s: string) => redactKey(s, KEY);

type Row = Record<string, unknown>;
const pick = (r: Row) => ({
  _id: r._id ?? null,
  ORDER_ID: r.ORDER_ID ?? null,
  batch: r.batch ?? null,
  cnote_no: r.cnote_no ?? null,
  status: r.status ?? null,
  isPaid: r.isPaid ?? null,
  isDeleted: r.isDeleted ?? null,
  destinationMark: r.destinationMark ?? null,
});

// A recording transport: the real fetch, plus the raw facts of each POST /order answer.
let last: { http: number; success: unknown; code: unknown; message: unknown; items: ReturnType<typeof pick>[]; idemSent: boolean } | null = null;
const recording: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  const url = String(input);
  if (init?.method === "POST" && url.endsWith("/order")) {
    const text = await res.clone().text();
    let body: Row = {};
    try {
      body = JSON.parse(text);
    } catch {
      /* unreadable — recorded as no items */
    }
    const data = Array.isArray(body.data) ? body.data : body.data && typeof body.data === "object" ? [body.data] : [];
    const headers = (init.headers ?? {}) as Record<string, string>;
    last = { http: res.status, success: body.success ?? null, code: body.code ?? null, message: typeof body.message === "string" ? red(body.message) : null, items: (data as Row[]).map(pick), idemSent: !!headers.idempotencyKey };
  }
  return res;
};
const call = { cfg, fetch: recording, timeoutMs: 30_000 };

async function rawGet(path: string): Promise<{ http: number; rows: Row[] }> {
  const res = await fetch(`${SANDBOX_BASE}/api/public/${encodeURIComponent(KEY!)}${path}`, { headers: { Accept: "application/json", "x-client-source": "directCall" } });
  const body = (await res.json().catch(() => ({}))) as Row;
  return { http: res.status, rows: Array.isArray(body.data) ? (body.data as Row[]) : [] };
}

async function create(label: string, payload: MgCreateOrderInput, idempotencyKey: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    last = null;
    let result: unknown;
    try {
      const r = await mgCreateOrder(payload, { ...call, idempotencyKey });
      result = r.ok ? { ok: true, id: r.data.id, orderId: r.data.orderId, batchCode: r.data.batchCode } : { ok: false, http: r.httpStatus, code: r.code ?? null, error: r.error };
    } catch (e) {
      result = { thrown: e instanceof Error ? e.name : "unknown", message: red(e instanceof Error ? e.message : String(e)) };
    }
    say(label, { attempt, client: result, raw: last });
    if (last?.http !== 409) return last;
    await sleep(3000 * (attempt + 1)); // 409 = a batch in flight on this account; nothing created
  }
  return last;
}

async function main() {
  const addrs = await mgPickupAddresses(call);
  if (!addrs.ok || !addrs.data.length) refuse(`no pickup address on the sandbox seller (${addrs.ok ? "0 rows" : red(addrs.error)})`);
  const addr = addrs.data.find((a) => a.areaId) ?? addrs.data[0];
  say("0 pickup", { addresses: addrs.data.length, addressId: addr.id, hasArea: !!addr.areaId });
  const dest = await mgSearchArea("kebayoran baru", call);
  if (!dest.ok || !dest.data.length) refuse("destination area search returned nothing");
  const destId = dest.data[0].id;
  let courier = "JT";
  if (addr.areaId) {
    const est = await mgEstimate({ originId: addr.areaId, destinationId: destId, kg: 1 }, call);
    const names = est.ok ? est.data.map((r) => r.shipment.courier) : [];
    say("0 estimate", { ok: est.ok, couriers: names });
    if (!names.includes("JT") && names.length) courier = names[0];
  }

  const RUN = `IDEM${Date.now().toString(36).toUpperCase()}`;
  const line = {
    customerName: "Penerima Uji Idempotensi",
    customerPhone: "081200000001",
    customerAddress: "Jl. Tujuan Uji No. 2, Kebayoran Baru",
    customerAddressDataId: destId,
    parcelContent: "Barang uji sandbox x1",
    weight: 1,
    quantity: 1,
    goodsValue: 150000,
    destinationMark: RUN,
  };
  const P: MgCreateOrderInput = { courier, pickup: { type: "dropOff", address_id: addr.id }, orders: [line] };
  const P2: MgCreateOrderInput = { ...P, orders: [{ ...line, parcelContent: "Barang uji sandbox x1 (diubah)" }] };
  const K1 = `tokophi-idem-${RUN}-k1`;
  const K2 = `tokophi-idem-${RUN}-k2`;
  say("run", { destinationMark: RUN, courier, pickup: "dropOff", body: "1 parcel, 1 kg, goodsValue 150000, non-COD", keys: { K1: K1.length, K2: K2.length } });

  const a = await create("A K1 body P", P, K1);
  await sleep(3000);
  const b = await create("B K1 body P (replay)", P, K1);
  await sleep(3000);
  const c = await create("C K2 body P (control)", P, K2);
  await sleep(3000);
  const d = await create("D K1 body P' (changed)", P2, K1);

  const ids = new Map<string, string>(); // _id → ORDER_ID
  const batches = new Set<string>();
  for (const r of [a, b, c, d]) for (const it of r?.items ?? []) {
    if (typeof it._id === "string") ids.set(it._id, String(it.ORDER_ID ?? ""));
    if (typeof it.batch === "string") batches.add(it.batch);
  }
  const aId = a?.items[0]?._id ?? null;
  const bId = b?.items[0]?._id ?? null;
  say("verdict", { A_id: aId, B_id: bId, replaySameId: !!aId && aId === bId, C_id: c?.items[0]?._id ?? null, D_http: d?.http ?? null, D_code: d?.code ?? null, distinctIdsSeen: ids.size });

  async function readBack(label: string) {
    const live = new Set<string>();
    for (const bc of batches) {
      const g = await rawGet(`/order?${new URLSearchParams({ batch: bc })}`);
      const mine = g.rows.filter((r) => r.destinationMark === RUN);
      for (const r of mine) if (r.isDeleted !== true) live.add(String(r._id));
      say(`${label} batch`, { batch: bc, http: g.http, rows: g.rows.length, mine: mine.map(pick) });
    }
    for (const [, oid] of ids) {
      if (!oid) continue;
      const g = await rawGet(`/order?${new URLSearchParams({ order_id: oid })}`);
      const mine = g.rows.filter((r) => r.ORDER_ID === oid);
      for (const r of mine) if (r.isDeleted !== true) live.add(String(r._id));
      say(`${label} order_id`, { orderId: oid, http: g.http, rows: g.rows.length, mine: mine.map(pick) });
    }
    say(`${label} count`, { liveShipmentsWithThisMark: live.size, ids: [...live] });
    return live;
  }
  const before = await readBack("readback");

  const toCancel = new Set([...ids.keys(), ...before]);
  const leftovers: string[] = [];
  for (const id of toCancel) {
    await sleep(1000);
    try {
      const x = await mgCancel(courier, [id], call);
      say("cancel", { id, ok: x.ok, deleted: x.ok ? x.data.deleted : null, http: x.ok ? 200 : x.httpStatus, error: x.ok ? null : red(x.error) });
      if (!x.ok) leftovers.push(id);
    } catch (e) {
      say("cancel", { id, thrown: e instanceof Error ? e.name : "unknown", message: red(e instanceof Error ? e.message : String(e)) });
      leftovers.push(id);
    }
  }
  const after = await readBack("after-cancel");
  say("done", { created: toCancel.size, cancelRefused: leftovers, stillLive: [...after] });
}

main().catch((e) => {
  console.error("mengantar-sandbox-idempotency failed:", e instanceof Error ? `${e.name}: ${red(e.message)}` : e);
  process.exit(1);
});
