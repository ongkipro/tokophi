// KiriminAja UAT simulation (KA-UAT, 2026-08-24) — the 9 scenarios their team asked for before
// issuing the production IP, driven through THE SAME client the product uses
// (`@tokophi/lib/kiriminaja`), never bare curl: what they are certifying is our integration method.
//
//   1–4  non-COD × (actual-dominant | volumetric-dominant) × (± insurance)
//   5–8  COD (SPX) × the same grid
//   9    cancel ONE booked package — by AWB, never the order id (N34); waits for the waybill first
//
// Run (repo root; sandbox is the default KIRIMINAJA_ENV):
//   npx tsx --env-file=apps/admin/.env.local ops/kiriminaja-uat-sim.ts
//
// ⚠️ SANDBOX ONLY. The script refuses to run when KIRIMINAJA_ENV=production: nine live bookings and
// a cancel are exactly the kind of side effect that must never ride an unread env default.
// It touches NO database — parcels are synthetic; every input is explicit below.
//
// Output: a table of scenario → OID (`ka_order_id`) + pickup number + quoted vs booked price, to be
// pasted into the UAT sheet's "Sample Order" column, plus the cancel result.
import { kaCancelShipment, kaCreateOrder, kaShippingPrice, kaTrack, kiriminajaConfigured } from "../packages/lib/src/kiriminaja";

if ((process.env.KIRIMINAJA_ENV ?? "sandbox") === "production") {
  console.error("REFUSED: KIRIMINAJA_ENV=production — this simulation books and cancels real parcels.");
  process.exit(1);
}
if (!kiriminajaConfigured()) {
  console.error("KIRIMINAJA_API_KEY is not set. Run with --env-file=apps/admin/.env.local");
  process.exit(1);
}

// Route: batiknusantara's real sender district → the destination used in the N30 measurement.
const ORIGIN = 6138; // Kotagede, Yogyakarta (store_settings.sender_kecamatan_id of the seeded store)
const DEST = 2107; // the district every prior live measurement used — known served, known COD-capable via SPX

// Two parcels, both inside the 1-kg chargeable band, chosen so the DOMINANT weight is unambiguous
// (KA: volumetric = w×l×h ÷ 6 in grams·cm):
//   actual-dominant:      1.000 g real vs 10×10×10 ⇒ ~167 g volumetric → actual wins
//   volumetric-dominant:    400 g real vs 15×15×24 ⇒   900 g volumetric → volume wins
//
// ⚠️ WHY THE BAND IS CAPPED AT 1 KG — MEASURED SANDBOX DEFECT, 2026-08-24: the sandbox QUOTE scales
// with chargeable weight (1 kg SPX Rp13.700 → 2 kg Rp27.400) but the sandbox BOOKING engine
// validates `shipping_cost` against a price that IGNORES weight scaling — every multi-kg booking at
// its own quoted price was refused "Ongkir tidak sesuai" (jne/spx/anteraja/sap/ninja/lion/idx/
// sicepat-REG), while the SAME 2 kg parcel was ACCEPTED at the 1-kg price (OID 5758-E1kgprice150)
// and flat-priced sicepat GOKIL booked fine at 5 kg (OID 5758-Qsicep937). Our integration passes
// the quote's own number, which is correct; the drift is between KA's two sandbox engines and is
// flagged to their team in the UAT notes. Volumetric PRICING at multi-kg is still demonstrated —
// quote-only, below — because the pricing rows of the UAT sheet need no OID.
const PARCELS = {
  actual: { weight: 1_000, lengthCm: 10, widthCm: 10, heightCm: 10 },
  volumetric: { weight: 400, lengthCm: 15, widthCm: 15, heightCm: 24 },
} as const;
const ITEM_VALUE = 150_000; // declared goods value — the insurance base where insurance is on

// Pickup schedule: TOMORROW 10:00 WIB, computed in Asia/Jakarta — the same rule createShipment uses
// (couriers enforce a daily cut-off; `now + 1h` is correctly refused by the API).
function pickupSchedule(): string {
  const jkt = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));
  jkt.setDate(jkt.getDate() + 1);
  const y = jkt.getFullYear(), m = String(jkt.getMonth() + 1).padStart(2, "0"), d = String(jkt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d} 10:00:00`;
}

const SENDER = { name: "UAT TokoPhi", phone: "6281227168633", address: "Jl. Kemasan No. 10, Kotagede", kecamatanId: ORIGIN };
const DEST_INFO = { destName: "Penerima UAT", destPhone: "6281234567890", destAddress: "Jl. Melati No. 12 RT 03 RW 05", destKecamatanId: DEST };

type Row = { sim: number; label: string; service: string; quoted: number; oid: string; pickup: string; note: string };
const rows: Row[] = [];
const fail = (sim: number, label: string, why: string) => rows.push({ sim, label, service: "-", quoted: 0, oid: "-", pickup: "-", note: `FAILED: ${why}` });

async function runScenario(sim: number, opts: { cod: boolean; parcel: keyof typeof PARCELS; insurance: boolean }) {
  const label = `${opts.cod ? "COD" : "non-COD"} · ${opts.parcel === "actual" ? "berat aktual dominan" : "volumetrik dominan"}${opts.insurance ? " · asuransi" : ""}`;
  const p = PARCELS[opts.parcel];
  const quote = await kaShippingPrice({
    origin: ORIGIN, destination: DEST, weight: p.weight,
    lengthCm: p.lengthCm, widthCm: p.widthCm, heightCm: p.heightCm,
    itemValue: ITEM_VALUE, insurance: opts.insurance ? 1 : 0,
  });
  if (!quote.ok || !quote.results.length) return fail(sim, label, `quote: ${quote.error ?? "no rates"}`);
  // COD rides SPX only (platform policy); non-COD takes the cheapest rate on the list.
  const candidates = opts.cod
    ? quote.results.filter((r) => r.service.toLowerCase() === "spx" && r.setting?.cod_fee != null)
    : quote.results;
  // The vendor sometimes returns numeric fields as STRINGS (the client's own comment at item_value
  // says so) — normalise before math and before echoing into the booking body, whose Go server
  // demands a real int for shipping_cost.
  const rate = [...candidates].map((r) => ({ ...r, cost: Number(r.cost) })).sort((a, b) => a.cost - b.cost)[0];
  if (!rate) return fail(sim, label, "no eligible rate (COD needs an SPX service on this route)");

  const codAmount = opts.cod ? ITEM_VALUE + rate.cost : 0;
  const r = await kaCreateOrder(
    SENDER,
    {
      ...DEST_INFO,
      // KA caps order_id at 20 chars INCLUDING the account prefix it carries — keep the ref tight.
      orderRef: `UAT${sim}${new Date().toISOString().slice(11, 19).replaceAll(":", "")}`,
      weight: p.weight, length: p.lengthCm, width: p.widthCm, height: p.heightCm,
      itemValue: ITEM_VALUE, itemName: `UAT skenario ${sim}`,
      service: rate.service, serviceType: String(rate.service_type), shippingCost: rate.cost,
      cod: codAmount,
      insuranceAmount: opts.insurance ? ITEM_VALUE : 0,
    },
    pickupSchedule(),
  );
  if (!r.ok) return fail(sim, label, `booking: ${r.error ?? "unknown"}`);
  rows.push({
    sim, label, service: `${rate.service} ${rate.service_name ?? rate.service_type}`, quoted: rate.cost,
    oid: r.kaOrderId ?? "-", pickup: r.pickupNumber ?? "-",
    note: opts.cod ? `COD tagih Rp${codAmount.toLocaleString("id-ID")}` : "",
  });
}

const GRID: { cod: boolean; parcel: keyof typeof PARCELS; insurance: boolean }[] = [
  { cod: false, parcel: "actual", insurance: false },
  { cod: false, parcel: "volumetric", insurance: false },
  { cod: false, parcel: "actual", insurance: true },
  { cod: false, parcel: "volumetric", insurance: true },
  { cod: true, parcel: "actual", insurance: false },
  { cod: true, parcel: "volumetric", insurance: false },
  { cod: true, parcel: "actual", insurance: true },
  { cod: true, parcel: "volumetric", insurance: true },
];

async function main() {
  // ── UAT sheet rows 2–3 (pricing, no OID needed): volumetric pricing demonstrated at multi-kg ──
  const pActual = await kaShippingPrice({ origin: ORIGIN, destination: DEST, weight: 5_000, lengthCm: 10, widthCm: 10, heightCm: 10, itemValue: ITEM_VALUE, insurance: 0 });
  const pVol = await kaShippingPrice({ origin: ORIGIN, destination: DEST, weight: 1_000, lengthCm: 40, widthCm: 30, heightCm: 20, itemValue: ITEM_VALUE, insurance: 0 });
  const spxA = pActual.results.find((r) => r.service === "spx");
  const spxV = pVol.results.find((r) => r.service === "spx");
  console.log("── PRICING EVIDENCE (quote-only, sheet rows 2–3) ──");
  console.log(`actual-dominant 5.000 g / 10×10×10  → SPX Rp${Number(spxA?.cost ?? 0).toLocaleString("id-ID")}`);
  console.log(`volumetric      1.000 g / 40×30×20  → SPX Rp${Number(spxV?.cost ?? 0).toLocaleString("id-ID")} (4.000 g volumetrik menang)`);

  for (let i = 0; i < GRID.length; i++) {
    await runScenario(i + 1, GRID[i]);
    console.log(`sim ${i + 1}/9 done`);
  }

  // ── scenario 9: cancel ONE package, by AWB (N34: "awb: AWB Number Already Obtained, Not Order ID").
  // The waybill only exists once a courier accepts the pickup, so poll tracking briefly for it.
  const victim = rows.find((r) => r.oid !== "-");
  if (!victim) {
    fail(9, "cancel", "no successful booking to cancel");
  } else {
    let awb: string | null = null;
    for (let i = 0; i < 6 && !awb; i++) {
      await new Promise((res) => setTimeout(res, 10_000));
      const t = await kaTrack(victim.oid);
      const d = (t.data ?? {}) as { awb?: string; waybill?: string };
      awb = [d.awb, d.waybill].find((x) => !!x && x !== victim.oid) ?? null;
    }
    if (!awb) {
      rows.push({ sim: 9, label: `cancel ${victim.oid}`, service: "-", quoted: 0, oid: victim.oid, pickup: "-", note: "AWB belum terbit setelah 60 dtk — jalankan ulang cancel nanti dengan AWB dari tracking" });
    } else {
      const c = await kaCancelShipment(awb, "UAT: pembatalan skenario 9");
      rows.push({ sim: 9, label: `cancel AWB ${awb}`, service: "-", quoted: 0, oid: victim.oid, pickup: "-", note: c.ok ? "accepted for cancellation (non-COD void antre ≤48 jam)" : `FAILED: ${c.error}` });
    }
  }

  console.log("\n═══ UAT SIMULATION RESULT (paste OIDs into the UAT sheet) ═══");
  for (const r of rows) {
    console.log(`#${r.sim} ${r.label}\n    service=${r.service} quoted=Rp${r.quoted.toLocaleString("id-ID")} OID=${r.oid} pickup=${r.pickup} ${r.note}`);
  }
  const failed = rows.filter((r) => r.note.startsWith("FAILED")).length;
  console.log(`\n${rows.length} rows, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

void main();

